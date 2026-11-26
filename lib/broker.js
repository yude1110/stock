// 交易介面（Broker Adapter）
// 所有券商 / 交易所的串接都實作同一組方法，前端與 API 不需要改：
//   info()                    → 券商名稱、支援的市場與委託類型
//   account()                 → 現金、持倉、損益
//   orders()                  → 委託 / 成交紀錄
//   placeOrder({ symbol, side, type, qty, price })
//   cancelOrder(id)
// 目前內建 PaperBroker（模擬交易）。未來串接真實券商（例如永豐 Shioaji、富邦 Neo、元大、Interactive Brokers、Alpaca），
// 只要在 lib/brokers/ 新增一個實作相同方法的 adapter，並用環境變數 BROKER=<名稱> 切換即可。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isTW } from './http.js';

const INITIAL = { TWD: 5_000_000, USD: 100_000 };

// 台股費用：手續費 0.1425%（最低 20 元）、證交稅賣出 0.3%（ETF 0.1%）；美股以零手續費計
function fees(symbol, side, amount) {
  if (!isTW(symbol)) return { fee: 0, tax: 0 };
  const fee = Math.max(20, Math.floor(amount * 0.001425));
  const isEtf = /^00/.test(symbol);
  const tax = side === 'sell' ? Math.floor(amount * (isEtf ? 0.001 : 0.003)) : 0;
  return { fee, tax };
}

export class PaperBroker {
  constructor({ file, getQuote }) {
    this.file = file;
    this.getQuote = getQuote;
    this.state = this.load();
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return this.fresh(); }
  }
  fresh() { return { cash: { ...INITIAL }, realized: { TWD: 0, USD: 0 }, positions: {}, orders: [], createdAt: new Date().toISOString() }; }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  info() {
    return {
      id: 'paper', name: '模擬交易（Paper Trading）', live: false, markets: ['tw', 'us'], orderTypes: ['market', 'limit'],
      notes: ['市價單以最新報價成交；限價單在價格觸及時成交（查詢帳戶時檢查）', '台股手續費 0.1425%（最低 20 元）、證交稅 0.3%（ETF 0.1%）；美股零手續費', '暫不支援放空與融資'],
      initial: INITIAL,
    };
  }

  tryFill(o, q) {
    if (!q || q.error || !q.price) return false;
    const px = q.price;
    if (o.type === 'limit' && (o.side === 'buy' ? o.price < px : o.price > px)) return false;
    const cur = isTW(o.symbol) ? 'TWD' : 'USD';
    const amount = px * o.qty;
    const { fee, tax } = fees(o.symbol, o.side, amount);
    const pos = this.state.positions[o.symbol] || { qty: 0, avgCost: 0, currency: cur, name: o.name };
    if (o.side === 'buy') {
      const cost = amount + fee;
      if (this.state.cash[cur] < cost) { Object.assign(o, { status: 'rejected', reason: `現金不足（需要 ${cost.toFixed(2)} ${cur}）` }); return true; }
      this.state.cash[cur] -= cost;
      pos.avgCost = (pos.avgCost * pos.qty + cost) / (pos.qty + o.qty); // 成本含手續費
      pos.qty += o.qty;
      this.state.positions[o.symbol] = pos;
    } else {
      if (pos.qty < o.qty) { Object.assign(o, { status: 'rejected', reason: `庫存不足（持有 ${pos.qty} 股）` }); return true; }
      const proceeds = amount - fee - tax;
      this.state.cash[cur] += proceeds;
      const pnl = proceeds - pos.avgCost * o.qty;
      this.state.realized[cur] += pnl;
      o.realizedPnl = pnl;
      pos.qty -= o.qty;
      if (pos.qty === 0) delete this.state.positions[o.symbol];
    }
    Object.assign(o, { status: 'filled', fillPrice: px, fee, tax, filledAt: new Date().toISOString() });
    return true;
  }

  async syncPending() {
    const pending = this.state.orders.filter(o => o.status === 'pending');
    if (!pending.length) return;
    const quotes = await this.getQuote([...new Set(pending.map(o => o.symbol))]);
    let changed = false;
    for (const o of pending) changed = this.tryFill(o, quotes[o.symbol]) || changed;
    if (changed) this.save();
  }

  async placeOrder({ symbol, side, type = 'market', qty, price, name }) {
    symbol = String(symbol || '').toUpperCase();
    qty = Math.floor(Number(qty));
    if (!symbol) throw new Error('缺少股票代號');
    if (!['buy', 'sell'].includes(side)) throw new Error('買賣別錯誤');
    if (!['market', 'limit'].includes(type)) throw new Error('委託類型錯誤');
    if (!(qty > 0)) throw new Error('數量必須大於 0');
    if (type === 'limit' && !(Number(price) > 0)) throw new Error('限價單需要價格');
    const quotes = await this.getQuote([symbol]);
    const q = quotes[symbol];
    if (!q || q.error) throw new Error('查無報價，無法下單');
    const o = {
      id: crypto.randomUUID().slice(0, 8), symbol, name: name || q.name || symbol, side, type, qty,
      price: type === 'limit' ? Number(price) : null, status: 'pending', createdAt: new Date().toISOString(),
    };
    this.state.orders.unshift(o);
    this.tryFill(o, q);
    this.state.orders = this.state.orders.slice(0, 300);
    this.save();
    return o;
  }

  cancelOrder(id) {
    const o = this.state.orders.find(x => x.id === id);
    if (!o) throw new Error('找不到委託');
    if (o.status !== 'pending') throw new Error('此委託已無法取消');
    o.status = 'cancelled'; o.cancelledAt = new Date().toISOString();
    this.save();
    return o;
  }

  async orders() { await this.syncPending(); return this.state.orders.slice(0, 100); }

  async account() {
    await this.syncPending();
    const syms = Object.keys(this.state.positions);
    const quotes = syms.length ? await this.getQuote(syms) : {};
    const totals = { TWD: { cash: this.state.cash.TWD, marketValue: 0, unrealized: 0, realized: this.state.realized.TWD }, USD: { cash: this.state.cash.USD, marketValue: 0, unrealized: 0, realized: this.state.realized.USD } };
    const positions = syms.map(s => {
      const p = this.state.positions[s], q = quotes[s];
      const price = q?.price ?? p.avgCost;
      const value = price * p.qty, cost = p.avgCost * p.qty;
      totals[p.currency].marketValue += value; totals[p.currency].unrealized += value - cost;
      return { symbol: s, name: q?.name || p.name, qty: p.qty, avgCost: p.avgCost, price, changePct: q?.changePct ?? null, value, cost, unrealized: value - cost, unrealizedPct: cost ? (value / cost - 1) * 100 : 0, currency: p.currency };
    });
    for (const c of Object.keys(totals)) {
      const t = totals[c];
      t.equity = t.cash + t.marketValue;
      t.returnPct = (t.equity / INITIAL[c] - 1) * 100;
    }
    return { broker: this.info().name, positions, totals, createdAt: this.state.createdAt };
  }

  reset() { this.state = this.fresh(); this.save(); return { ok: true }; }
}
