// 即時股票追蹤器 — Node 伺服器（Node 18+）
// 美股：Yahoo Finance、Nasdaq；台股：Yahoo 奇摩股市（即時、上市/上櫃排行）、FinMind（籌碼、月營收）、鉅亨網與 Google 新聞
// 個股分析：技術面（lib/indicators.js）、基本面（lib/fundamentals.js）、籌碼面（lib/chips.js）、消息面（新聞 + 翻譯摘要）
// 交易：lib/broker.js（目前為模擬交易，未來可換成真實券商 adapter）
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { translate, translateMany, summarize, storeArticle, aiEnabled } from './translate.js';
import { cached, fetchText, getJSON, num, isTW } from './lib/http.js';
import { analyze, resample } from './lib/indicators.js';
import { fundamentals, finmind } from './lib/fundamentals.js';
import { chips } from './lib/chips.js';
import { PaperBroker } from './lib/broker.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // 有交易功能，預設只讓本機連線
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const Y = 'https://query1.finance.yahoo.com';
const YTW = 'https://tw.stock.yahoo.com/_td-stock/api/resource';

// ================= 美股 =================
function pickUS(q) {
  return {
    symbol: q.symbol,
    name: q.shortName || q.longName || q.displayName || q.symbol,
    price: q.regularMarketPrice,
    change: q.regularMarketChange,
    changePct: q.regularMarketChangePercent,
    volume: q.regularMarketVolume,
    avgVolume: q.averageDailyVolume3Month,
    marketCap: q.marketCap,
    marketState: q.marketState,
  };
}

const usScreener = id => cached(`scr:${id}`, 30_000, async () => {
  const j = await getJSON(`${Y}/v1/finance/screener/predefined/saved?scrIds=${id}&count=25`);
  return (j.finance?.result?.[0]?.quotes || []).map(pickUS);
});

const yahooNews = (query, count = 8) => cached(`ynews:${query}:${count}`, 5 * 60_000, async () => {
  const j = await getJSON(`${Y}/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${count}&quotesCount=0`);
  return (j.news || []).map(n => ({
    title: n.title, publisher: n.publisher, link: n.link, time: n.providerPublishTime,
    tickers: n.relatedTickers || [],
    thumb: n.thumbnail?.resolutions?.find(r => r.tag === '140x140')?.url || null,
  }));
});

async function usReasons(symbol) {
  const list = await yahooNews(symbol).catch(() => []);
  const related = list.filter(n => n.tickers.includes(symbol));
  return (related.length ? related : list).sort((a, b) => b.time - a.time).slice(0, 3);
}

// v8 圖表（美股與台股長天期走勢）
const RANGE_INTERVAL = { '1d': '5m', '5d': '15m', '1mo': '60m', '6mo': '1d', '1y': '1d', '5y': '1wk' };
const v8Chart = (symbol, range = '1d') => cached(`v8:${symbol}:${range}`, range === '1d' ? 15_000 : 5 * 60_000, async () => {
  const j = await getJSON(`${Y}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${RANGE_INTERVAL[range] || '5m'}&includePrePost=false`);
  const res = j.chart?.result?.[0];
  if (!res) throw new Error('no data');
  const m = res.meta, q = res.indicators?.quote?.[0] || {};
  const prev = m.chartPreviousClose ?? m.previousClose;
  const price = m.regularMarketPrice;
  // 1D 的基準是昨收；長天期以區間第一筆為基準
  const prevClose = range === '1d' ? (m.previousClose ?? prev) : prev;
  return {
    symbol: m.symbol, name: m.shortName || m.longName || m.symbol, currency: m.currency,
    price, prevClose, change: price - prevClose, changePct: prevClose ? (price - prevClose) / prevClose * 100 : null,
    dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow, volume: m.regularMarketVolume,
    time: m.regularMarketTime, series: toSeries(res.timestamp, q),
  };
});

function toSeries(ts = [], q = {}) {
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    out.push({ t: ts[i], o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close[i], v: q.volume?.[i] || 0 });
  }
  return out;
}

// ================= 台股 =================
// Yahoo 奇摩股市的即時走勢（可一次查多檔，1 分 K，含漲跌停資訊與中文名稱）
const twCharts = symbols => cached(`twc:${symbols.join(',')}`, 10_000, async () => {
  const j = await getJSON(`${YTW}/FinanceChartService.ApacLibraCharts;symbols=${encodeURIComponent(JSON.stringify(symbols))};type=tick`);
  return j.map(x => {
    const c = x.chart;
    if (!c?.meta) return { symbol: x.symbol, error: true };
    const m = c.meta, q = c.quote || {};
    const price = num(q.price) ?? m.regularMarketPrice;
    const prevClose = num(q.previousClose) ?? m.previousClose;
    return {
      symbol: x.symbol, name: m.name || x.symbol, currency: m.currency || 'TWD',
      price, prevClose, change: price - prevClose, changePct: prevClose ? (price - prevClose) / prevClose * 100 : null,
      open: num(q.openPrice), dayHigh: num(q.dayHighPrice), dayLow: num(q.dayLowPrice),
      volume: num(q.volume), limitUp: !!q.limitUp, limitDown: !!q.limitDown,
      time: m.regularMarketTime, series: toSeries(c.timestamp, c.indicators?.quote?.[0]),
    };
  });
});

// 排行：exchange = TAI(上市) / TWO(上櫃)；sortBy = -changePercent / changePercent / -turnoverK / -volume
const twRank = (exchange, sortBy, limit = 30) => cached(`rank:${exchange}:${sortBy}`, 30_000, async () => {
  const j = await getJSON(`${YTW}/StockServices.rank;exchange=${exchange};limit=${limit};offset=0;period=1D;sortBy=${sortBy}`);
  return (j.list || []).map(x => ({
    symbol: x.symbol, name: x.symbolName || x.name,
    price: num(x.price), change: num(x.change), changePct: num(x.changePercent),
    volume: num(x.volume), turnover: (num(x.turnoverK) || 0) * 1000,
    limitUp: x.limitUp, limitDown: x.limitDown,
  }));
});

// 台股盤中狀態（台北時間 週一~五 09:00–13:30）
function twState() {
  const t = new Date(Date.now() + 8 * 3600_000);
  const d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (d === 0 || d === 6) return 'CLOSED';
  if (m >= 540 && m <= 810) return 'REGULAR';
  if (m >= 510 && m < 540) return 'PRE';
  return 'CLOSED';
}

// Google 新聞 RSS（繁中）：找個股漲跌原因
const googleNews = query => cached(`gnews:${query}`, 10 * 60_000, async () => {
  const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`);
  const tag = (s, k) => (s.match(new RegExp(`<${k}[^>]*>([\\s\\S]*?)</${k}>`)) || [])[1] || '';
  const unesc = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return xml.split('<item>').slice(1).map(it => {
    const source = unesc(tag(it, 'source'));
    let title = unesc(tag(it, 'title'));
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, publisher: source, link: unesc(tag(it, 'link')), time: Date.parse(tag(it, 'pubDate')) / 1000, tickers: [], thumb: null };
  });
});

async function twReasons(symbol, name, changePct) {
  const code = symbol.split('.')[0];
  const dir = changePct > 0 ? '漲' : changePct < 0 ? '跌' : '股價';
  const list = await googleNews(`"${name || code}" ${dir} when:2d`).catch(() => []);
  const fallback = list.length ? list : await googleNews(`${code} ${name || ''} when:3d`).catch(() => []);
  return fallback.sort((a, b) => b.time - a.time).slice(0, 3);
}

// 鉅亨網台股新聞（大盤）
const cnyes = category => cached(`cnyes:${category}`, 5 * 60_000, async () => {
  const j = await getJSON(`https://api.cnyes.com/media/api/v1/newslist/category/${category}?limit=20`);
  return (j.items?.data || []).map(n => {
    const link = `https://news.cnyes.com/news/id/${n.newsId}`;
    storeArticle(link, n.content); // 列表就帶全文，留給摘要用
    return {
    title: n.title, publisher: '鉅亨網', link, time: n.publishAt,
    tickers: [...(n.market || []), ...(n.stock || [])].map(s => s.name || s.code).filter(Boolean).slice(0, 4),
    thumb: n.coverSrc?.s?.src || n.coverSrc?.xs?.src || null,
  };
  });
});

// ================= 共用：報價 / 圖表 =================
async function quotes(symbols) {
  const tw = symbols.filter(isTW), us = symbols.filter(s => !isTW(s));
  const twRes = [];
  for (let i = 0; i < tw.length; i += 20) twRes.push(...await twCharts(tw.slice(i, i + 20)).catch(() => tw.slice(i, i + 20).map(s => ({ symbol: s, error: true }))));
  const usRes = await Promise.all(us.map(s => v8Chart(s).catch(() => ({ symbol: s, error: true }))));
  const map = new Map([...twRes, ...usRes].map(x => [x.symbol, x]));
  // 列表只需要縮圖用的收盤序列，減少傳輸量
  return symbols.map(s => {
    const x = map.get(s) || { symbol: s, error: true };
    return x.error ? x : { ...x, series: undefined, spark: x.series.map(p => p.c) };
  });
}

async function chart(symbol, range) {
  if (range === '1d' && isTW(symbol)) return (await twCharts([symbol]))[0];
  try { return await v8Chart(symbol, range); }
  catch (e) {
    // ^TWOII、台指期在 v8 查不到長天期，退回當日走勢
    if (isTW(symbol)) return { ...(await twCharts([symbol]))[0], fallback: true };
    throw e;
  }
}

// ================= 個股分析：歷史 K 線 + 技術面 =================
// 日K：2 年；週K：10 年；月K：全部
const TF = { D: ['2y', '1d'], W: ['10y', '1wk'], M: ['max', '1mo'] };
const history = (symbol, tf) => cached(`bars:${symbol}:${tf}`, tf === 'D' ? 60_000 : 30 * 60_000, async () => {
  const [range, interval] = TF[tf];
  const j = await getJSON(`${Y}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const res = j.chart?.result?.[0];
  if (!res?.timestamp) throw new Error('查無歷史資料');
  const q = res.indicators.quote[0];
  const bars = res.timestamp.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 }))
    .filter(b => b.c != null && b.o != null && b.h != null && b.l != null);
  return { meta: res.meta, bars };
});

async function technical(symbol, tf) {
  let { meta, bars } = await history(symbol, tf);
  // 台股日K最後一根用 Yahoo 奇摩的即時價覆蓋（v8 的台股日K盤中可能延遲）
  if (isTW(symbol) && tf === 'D') {
    const live = (await twCharts([symbol]).catch(() => []))[0];
    const last = bars[bars.length - 1];
    if (live && !live.error && last) {
      const day = t => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);
      const bar = { t: live.time, o: live.open ?? live.price, h: live.dayHigh ?? live.price, l: live.dayLow ?? live.price, c: live.price, v: live.volume ?? 0 };
      if (day(last.t) === day(live.time)) bars = [...bars.slice(0, -1), { ...bar, t: last.t }];
      else if (live.time > last.t) bars = [...bars, bar];
    }
  }
  if (bars.length < 30) throw new Error('歷史資料不足，無法計算技術指標');
  const a = analyze(bars);
  return { symbol, tf, name: meta.shortName || meta.longName || symbol, currency: meta.currency, bars, ...a };
}

// ================= 代號搜尋（支援中文名稱） =================
const twList = () => cached('twlist', 24 * 3600_000, async () => {
  const rows = await finmind('TaiwanStockInfo', '', '2000-01-01').catch(() => []);
  const seen = new Map();
  for (const r of rows) if (/^\d{4,6}[A-Z]?$/.test(r.stock_id) && !seen.has(r.stock_id))
    seen.set(r.stock_id, { symbol: r.stock_id + (r.type === 'tpex' ? '.TWO' : '.TW'), name: r.stock_name, industry: r.industry_category, exchange: r.type === 'tpex' ? '上櫃' : '上市' });
  return [...seen.values()];
});

async function search(q) {
  q = q.trim();
  if (!q) return [];
  const up = q.toUpperCase();
  const tw = (await twList()).filter(s => s.symbol.startsWith(up) || s.name.includes(q))
    .sort((a, b) => (a.symbol.split('.')[0] === up ? -1 : 0) - (b.symbol.split('.')[0] === up ? -1 : 0) || a.symbol.length - b.symbol.length).slice(0, 8);
  let us = [];
  if (/^[A-Za-z.\-^=]+$/.test(q)) {
    const j = await cached(`ysearch:${up}`, 3600_000, () => getJSON(`${Y}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`)).catch(() => ({}));
    us = (j.quotes || []).filter(x => x.symbol && x.quoteType !== 'OPTION').map(x => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp, industry: x.industry || x.typeDisp }));
  }
  return [...tw, ...us].slice(0, 12);
}

// ================= 交易（Broker Adapter） =================
const broker = new PaperBroker({
  file: path.join(ROOT, 'data', 'paper-account.json'),
  getQuote: async syms => Object.fromEntries((await quotes(syms)).map(q => [q.symbol, q])),
});

// ================= 市場設定 =================
const MARKETS = {
  us: {
    indices: ['^GSPC', '^IXIC', '^DJI', '^SOX', '^VIX', 'BTC-USD'],
    etfs: ['SPY', 'QQQ', 'DIA', 'IWM', 'SMH', 'SOXX', 'TQQQ', 'SOXL', 'ARKK', 'TLT', 'GLD', 'VT'],
  },
  tw: {
    indices: ['^TWII', '^TWOII', 'WTX&', '0050.TW', '2330.TW', 'TWD=X'],
    etfs: ['0050.TW', '006208.TW', '0056.TW', '00878.TW', '00919.TW', '00929.TW', '00713.TW', '00940.TW',
      '00692.TW', '00881.TW', '00891.TW', '00757.TW', '00646.TW', '00631L.TW', '00632R.TW', '00679B.TWO'],
  },
};

async function headlines(market, n = 8) {
  return cached(`headlines:${market}`, 60_000, async () => {
    let pool;
    if (market === 'tw') {
      const lists = await Promise.all([
        twRank('TAI', '-changePercent'), twRank('TAI', 'changePercent'), twRank('TAI', '-turnoverK'),
        twRank('TWO', '-changePercent'), twRank('TWO', 'changePercent'), twRank('TWO', '-turnoverK'),
      ]);
      const seen = new Set();
      // 個股為主（ETF 另有專區），成交值至少 3 億避免冷門股；分數 = 漲跌幅 × log(成交值)
      pool = lists.flat()
        .filter(q => q.changePct != null && q.turnover >= 3e8 && !/^00/.test(q.symbol) && !seen.has(q.symbol) && seen.add(q.symbol))
        .map(q => ({ ...q, marketState: twState(), score: Math.abs(q.changePct) * Math.log10(q.turnover) }));
    } else {
      const [g, l, a] = await Promise.all([usScreener('day_gainers'), usScreener('day_losers'), usScreener('most_actives')]);
      const seen = new Set();
      pool = [...g.slice(0, 10), ...l.slice(0, 10), ...a.slice(0, 15)]
        .filter(q => q.changePct != null && !seen.has(q.symbol) && seen.add(q.symbol))
        .map(q => ({ ...q, score: Math.abs(q.changePct) * Math.log10(Math.max(q.marketCap || 1e9, 1e9)) }));
    }
    pool = pool.sort((x, y) => y.score - x.score).slice(0, n);
    return Promise.all(pool.map(async q => ({
      ...q, reasons: market === 'tw' ? await twReasons(q.symbol, q.name, q.changePct) : await usReasons(q.symbol),
    })));
  });
}

async function movers(market) {
  if (market === 'tw') {
    const ex = async e => {
      const [gainers, losers, turnover, volume] = await Promise.all([
        twRank(e, '-changePercent'), twRank(e, 'changePercent'), twRank(e, '-turnoverK'), twRank(e, '-volume')]);
      return { gainers, losers, turnover, volume };
    };
    const [tse, otc] = await Promise.all([ex('TAI'), ex('TWO')]);
    return { tse, otc, state: twState() };
  }
  const [gainers, losers, actives] = await Promise.all([usScreener('day_gainers'), usScreener('day_losers'), usScreener('most_actives')]);
  return { gainers, losers, actives, state: gainers[0]?.marketState };
}

async function marketNews(market) {
  if (market === 'tw') {
    const [a, b] = await Promise.all([cnyes('tw_stock').catch(() => []), googleNews('台股 when:1d').catch(() => [])]);
    return [...a, ...b.slice(0, 8)].sort((x, y) => y.time - x.time).slice(0, 20);
  }
  const lists = await Promise.all(['^GSPC', 'stock market', '^IXIC'].map(q => yahooNews(q, 10).catch(() => [])));
  const seen = new Set();
  return lists.flat().filter(n => !seen.has(n.link) && seen.add(n.link)).sort((a, b) => b.time - a.time).slice(0, 20);
}

// ================= HTTP =================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > 1e6) throw new Error('內容太大'); }
  return body ? JSON.parse(body) : {};
}

// 翻譯 / 摘要（POST JSON）
const postRoutes = {
  '/api/translate': b => Array.isArray(b.texts)
    ? translateMany(b.texts.slice(0, 100), b.to || 'zh-TW').then(texts => ({ texts }))
    : translate(b.text, b.to || 'auto'),
  '/api/summarize': b => {
    if (!b.link && !b.text) throw new Error('缺少 link 或 text');
    if (b.link && !/^https?:\/\//.test(b.link)) throw new Error('網址格式錯誤');
    return summarize({ link: b.link, text: b.text, title: b.title });
  },
  '/api/broker/order': b => broker.placeOrder(b),
  '/api/broker/cancel': b => broker.cancelOrder(b.id),
  '/api/broker/reset': () => broker.reset(),
};

const sym = u => { const s = (u.searchParams.get('symbol') || '').trim().toUpperCase(); if (!s) throw new Error('缺少 symbol'); return s; };
const mk = u => u.searchParams.get('market') === 'tw' ? 'tw' : 'us';
const routes = {
  '/api/features': () => ({ ai: aiEnabled() }),
  '/api/headlines': u => headlines(mk(u)),
  '/api/movers': u => movers(mk(u)),
  '/api/indices': u => quotes(MARKETS[mk(u)].indices),
  '/api/etfs': u => quotes(MARKETS[mk(u)].etfs),
  '/api/quotes': u => {
    const syms = (u.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);
    return quotes(syms);
  },
  '/api/chart': u => {
    const range = RANGE_INTERVAL[u.searchParams.get('range')] ? u.searchParams.get('range') : '1d';
    return chart((u.searchParams.get('symbol') || '').toUpperCase(), range);
  },
  '/api/search': u => search(u.searchParams.get('q') || ''),
  '/api/stock/technical': u => technical(sym(u), ['D', 'W', 'M'].includes(u.searchParams.get('tf')) ? u.searchParams.get('tf') : 'D'),
  '/api/stock/fundamental': u => fundamentals(sym(u)),
  '/api/stock/chips': u => chips(sym(u)),
  '/api/broker/info': () => broker.info(),
  '/api/broker/account': () => broker.account(),
  '/api/broker/orders': () => broker.orders(),
  '/api/news': u => {
    const sym = (u.searchParams.get('symbol') || '').toUpperCase();
    if (!sym) return marketNews(mk(u));
    return isTW(sym) ? twReasons(sym, u.searchParams.get('name'), num(u.searchParams.get('pct'))) : usReasons(sym);
  },
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST' && postRoutes[u.pathname]) {
      try { return send(res, 200, await postRoutes[u.pathname](await readBody(req))); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (routes[u.pathname]) return send(res, 200, await routes[u.pathname](u));
    const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const full = path.join(ROOT, 'public', path.normalize(file));
    if (!full.startsWith(path.join(ROOT, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
    const data = await readFile(full);
    send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'not found', 'text/plain');
    console.error(e.message);
    send(res, 502, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`股票追蹤器已啟動：http://localhost:${PORT}${HOST === '127.0.0.1' ? '（僅本機可連線，可用 HOST=0.0.0.0 開放區網）' : ''}`));
