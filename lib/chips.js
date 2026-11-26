// 籌碼面
// 台股（FinMind）：三大法人買賣超、連買連賣、融資融券、券資比、外資持股比率、當沖率
// 美股（Nasdaq）：機構持股、持股增減、主要持有人、放空餘額（Short Interest）、內部人交易
import { cached, num, isTW, daysAgo } from './http.js';
import { finmind, nasdaq } from './fundamentals.js';

const sumLast = (rows, key, n) => rows.slice(-n).reduce((a, r) => a + (r[key] || 0), 0);
function streak(rows, key) {
  // 從最新一天往回數，同方向連續幾天（正 = 連買、負 = 連賣）
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key];
    if (!v) break;
    if (n === 0) n = Math.sign(v);
    else if (Math.sign(v) === Math.sign(n)) n += Math.sign(v);
    else break;
  }
  return n;
}

async function twChips(code) {
  const start = daysAgo(130);
  const [inst, margin, hold, dt, price] = await Promise.allSettled([
    finmind('TaiwanStockInstitutionalInvestorsBuySell', code, start),
    finmind('TaiwanStockMarginPurchaseShortSale', code, start),
    finmind('TaiwanStockShareholding', code, start),
    finmind('TaiwanStockDayTrading', code, daysAgo(70)),
    finmind('TaiwanStockPrice', code, daysAgo(70)),
  ]);
  const out = { market: 'tw' };

  if (inst.status === 'fulfilled') {
    const byDate = new Map();
    for (const r of inst.value) {
      const d = byDate.get(r.date) || { date: r.date, foreign: 0, trust: 0, dealer: 0 };
      const net = (r.buy - r.sell) / 1000; // 股 → 張
      if (r.name === 'Foreign_Investor' || r.name === 'Foreign_Dealer_Self') d.foreign += net;
      else if (r.name === 'Investment_Trust') d.trust += net;
      else if (r.name === 'Dealer_self' || r.name === 'Dealer_Hedging') d.dealer += net;
      byDate.set(r.date, d);
    }
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(r => ({ ...r, total: r.foreign + r.trust + r.dealer })).slice(-60);
    const sums = {};
    for (const n of [1, 5, 20, 60]) sums[n] = { foreign: sumLast(rows, 'foreign', n), trust: sumLast(rows, 'trust', n), dealer: sumLast(rows, 'dealer', n), total: sumLast(rows, 'total', n) };
    out.institutional = { rows, sums, streak: { foreign: streak(rows, 'foreign'), trust: streak(rows, 'trust'), dealer: streak(rows, 'dealer') } };
  }

  if (margin.status === 'fulfilled') {
    const rows = margin.value.map(r => ({
      date: r.date,
      marginBal: r.MarginPurchaseTodayBalance, marginChg: r.MarginPurchaseTodayBalance - r.MarginPurchaseYesterdayBalance, marginLimit: r.MarginPurchaseLimit,
      shortBal: r.ShortSaleTodayBalance, shortChg: r.ShortSaleTodayBalance - r.ShortSaleYesterdayBalance,
      offset: r.OffsetLoanAndShort,
    })).map(r => ({ ...r, shortRatio: r.marginBal ? r.shortBal / r.marginBal * 100 : null, usage: r.marginLimit ? r.marginBal / r.marginLimit * 100 : null }))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
    const l = rows[rows.length - 1], f20 = rows[rows.length - 21];
    out.margin = { rows, latest: l, marginChg20: l && f20 ? l.marginBal - f20.marginBal : null, shortChg20: l && f20 ? l.shortBal - f20.shortBal : null };
  }

  if (hold.status === 'fulfilled') {
    const rows = hold.value.map(r => ({ date: r.date, ratio: r.ForeignInvestmentSharesRatio, upperLimit: r.ForeignInvestmentUpperLimitRatio, shares: r.ForeignInvestmentShares }))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
    const l = rows[rows.length - 1], f20 = rows[rows.length - 21];
    out.foreignHolding = { rows, latest: l, chg20: l && f20 ? l.ratio - f20.ratio : null };
  }

  if (dt.status === 'fulfilled' && price.status === 'fulfilled') {
    const vol = new Map(price.value.map(p => [p.date, p.Trading_Volume]));
    const rows = dt.value.map(r => ({ date: r.date, volume: r.Volume, ratio: vol.get(r.date) ? r.Volume / vol.get(r.date) * 100 : null, buy: r.BuyAmount, sell: r.SellAmount }))
      .filter(r => r.ratio) // 當天資料尚未公布時為 0，略過
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-40);
    const avg = rows.length ? rows.slice(-20).reduce((a, r) => a + r.ratio, 0) / Math.min(20, rows.length) : null;
    out.dayTrading = { rows, latest: rows[rows.length - 1], avg20: avg };
  }
  return out;
}

async function usChips(symbol) {
  const [inst, short, insider] = await Promise.allSettled([
    nasdaq(`company/${symbol}/institutional-holdings?limit=15&type=TOTAL&sortColumn=marketValue`),
    nasdaq(`quote/${symbol}/short-interest?assetClass=stocks`),
    nasdaq(`company/${symbol}/insider-trades?limit=15&type=ALL`),
  ]);
  const out = { market: 'us' };
  const i = inst.status === 'fulfilled' ? inst.value?.data : null;
  if (i) {
    const pos = Object.fromEntries((i.activePositions?.rows || []).map(r => [r.positions, { holders: num(r.holders), shares: num(r.shares) }]));
    const nsp = Object.fromEntries((i.newSoldOutPositions?.rows || []).map(r => [r.positions, { holders: num(r.holders), shares: num(r.shares) }]));
    out.institutional = {
      ownershipPct: num(i.ownershipSummary?.SharesOutstandingPCT?.value),
      sharesOutstandingM: num(i.ownershipSummary?.ShareoutstandingTotal?.value),
      totalValueM: num(i.ownershipSummary?.TotalHoldingsValue?.value),
      increased: pos['Increased Positions'], decreased: pos['Decreased Positions'], held: pos['Held Positions'], total: pos['Total Institutional Shares'],
      newPositions: nsp['New Positions'], soldOut: nsp['Sold Out Positions'],
      holders: (i.holdingsTransactions?.table?.rows || []).map(r => ({
        name: r.ownerName, date: r.date, shares: num(r.sharesHeld), change: num(r.sharesChange), changePct: num(r.sharesChangePCT), value: num(r.marketValue) * 1000,
      })),
    };
  }
  const s = short.status === 'fulfilled' ? short.value?.data : null;
  if (s?.shortInterestTable?.rows) {
    out.shortInterest = s.shortInterestTable.rows.map(r => ({ date: r.settlementDate, interest: num(r.interest), avgVolume: num(r.avgDailyShareVolume), daysToCover: num(r.daysToCover) })).reverse();
  }
  const d = insider.status === 'fulfilled' ? insider.value?.data : null;
  if (d) {
    const table = rows => Object.fromEntries((rows || []).map(r => [r.insiderTrade, { m3: num(r.months3), m12: num(r.months12) }]));
    out.insider = {
      trades: table(d.numberOfTrades?.rows), shares: table(d.numberOfSharesTraded?.rows),
      rows: (d.transactionTable?.table?.rows || []).map(r => ({
        name: r.insider, relation: r.relation, date: r.lastDate, type: r.transactionType, own: r.ownType, shares: num(r.sharesTraded), price: num(r.lastPrice), held: num(r.sharesHeld),
      })),
    };
  }
  return out;
}

export function chips(symbol) {
  return cached(`chips:${symbol}`, 20 * 60_000, () => isTW(symbol) ? twChips(symbol.split('.')[0]) : usChips(symbol));
}
