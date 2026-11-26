// 基本面：估值、季度財報、財務體質、成長率
// 共用：Yahoo 基本面時間序列（美股、台股皆可）
// 台股另加 FinMind：月營收（YoY / MoM / 累計）、股利政策、本益比 / 淨值比歷史位階、產業別
// 美股另加 Nasdaq：產業、分析師目標價與評等、股利
import { cached, getJSON, num, isTW, daysAgo } from './http.js';

const TS = 'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/';
const TYPES = [
  'trailingPeRatio', 'trailingForwardPeRatio', 'trailingPbRatio', 'trailingPsRatio', 'trailingPegRatio', 'trailingEnterprisesValueEBITDARatio', 'trailingMarketCap',
  'quarterlyTotalRevenue', 'quarterlyGrossProfit', 'quarterlyOperatingIncome', 'quarterlyNetIncome', 'quarterlyDilutedEPS',
  'quarterlyOperatingCashFlow', 'quarterlyFreeCashFlow', 'quarterlyStockholdersEquity', 'quarterlyTotalDebt', 'quarterlyCashAndCashEquivalents',
  'quarterlyTotalAssets', 'quarterlyCurrentAssets', 'quarterlyCurrentLiabilities', 'quarterlyOrdinarySharesNumber',
  'trailingTotalRevenue', 'trailingNetIncome', 'trailingDilutedEPS',
  'annualTotalRevenue', 'annualNetIncome', 'annualDilutedEPS', 'annualFreeCashFlow', 'annualGrossProfit', 'annualOperatingIncome',
];

const yahooFundamentals = symbol => cached(`yfund:${symbol}`, 6 * 3600_000, async () => {
  const p1 = Math.floor(Date.now() / 1000) - 6 * 365 * 86400, p2 = Math.floor(Date.now() / 1000) + 86400;
  const j = await getJSON(`${TS}${encodeURIComponent(symbol)}?type=${TYPES.join(',')}&period1=${p1}&period2=${p2}`);
  const out = {};
  for (const r of j.timeseries?.result || []) {
    const t = r.meta?.type?.[0];
    out[t] = (r[t] || []).filter(Boolean).map(x => ({ date: x.asOfDate, value: x.reportedValue?.raw ?? null }))
      .filter(x => x.value != null).sort((a, b) => a.date.localeCompare(b.date));
    out._currency ??= (r[t] || []).find(Boolean)?.currencyCode;
  }
  return out;
});

// ---------- FinMind（台股） ----------
const FM = 'https://api.finmindtrade.com/api/v4/data';
export const finmind = (dataset, id, start) => cached(`fm:${dataset}:${id}:${start}`, 30 * 60_000, async () => {
  const token = process.env.FINMIND_TOKEN ? `&token=${process.env.FINMIND_TOKEN}` : '';
  const j = await getJSON(`${FM}?dataset=${dataset}&data_id=${id}&start_date=${start}${token}`);
  if (j.status !== 200) throw new Error(`FinMind ${dataset}: ${j.msg}`);
  return j.data || [];
});

// 百分位：目前值在歷史中的位置（0 = 歷史最低，100 = 歷史最高）
const percentile = (arr, v) => arr.length && v != null ? Math.round(arr.filter(x => x <= v).length / arr.length * 100) : null;

async function twExtras(code) {
  const [rev, div, per, info, fin] = await Promise.allSettled([
    finmind('TaiwanStockMonthRevenue', code, daysAgo(3 * 365 + 60)),
    finmind('TaiwanStockDividend', code, daysAgo(7 * 365)),
    finmind('TaiwanStockPER', code, daysAgo(3 * 365)),
    finmind('TaiwanStockInfo', code, '2000-01-01'),
    finmind('TaiwanStockFinancialStatements', code, daysAgo(3 * 365 + 120)),
  ]);
  const out = {};
  if (rev.status === 'fulfilled') {
    const rows = rev.value.map(r => ({ y: r.revenue_year, m: r.revenue_month, revenue: r.revenue }))
      .sort((a, b) => a.y - b.y || a.m - b.m);
    const byKey = new Map(rows.map(r => [`${r.y}-${r.m}`, r.revenue]));
    out.monthlyRevenue = rows.map((r, i) => {
      const prevM = i > 0 ? rows[i - 1].revenue : null, lastY = byKey.get(`${r.y - 1}-${r.m}`);
      const cum = rows.filter(x => x.y === r.y && x.m <= r.m).reduce((a, x) => a + x.revenue, 0);
      const cumLast = rows.filter(x => x.y === r.y - 1 && x.m <= r.m).reduce((a, x) => a + x.revenue, 0);
      return {
        ym: `${r.y}/${String(r.m).padStart(2, '0')}`, revenue: r.revenue,
        mom: prevM ? (r.revenue / prevM - 1) * 100 : null, yoy: lastY ? (r.revenue / lastY - 1) * 100 : null,
        cum, cumYoY: cumLast && rows.filter(x => x.y === r.y - 1 && x.m <= r.m).length === r.m ? (cum / cumLast - 1) * 100 : null,
      };
    }).slice(-25);
  }
  if (div.status === 'fulfilled') {
    out.dividends = div.value.map(d => ({
      period: d.year, cash: (d.CashEarningsDistribution || 0) + (d.CashStatutorySurplus || 0),
      stock: (d.StockEarningsDistribution || 0) + (d.StockStatutorySurplus || 0),
      exDate: d.CashExDividendTradingDate || d.StockExDividendTradingDate || '', payDate: d.CashDividendPaymentDate || '', announced: d.AnnouncementDate,
    })).filter(d => d.cash || d.stock).sort((a, b) => (b.announced || '').localeCompare(a.announced || '')).slice(0, 16);
  }
  if (per.status === 'fulfilled' && per.value.length) {
    const rows = per.value.filter(r => r.PER > 0 || r.PBR > 0);
    const last = rows[rows.length - 1];
    out.perHistory = rows.filter((_, i) => i % 3 === 0 || i === rows.length - 1).map(r => ({ date: r.date, per: r.PER, pbr: r.PBR, yield: r.dividend_yield }));
    out.twValuation = {
      per: last?.PER || null, pbr: last?.PBR || null, yield: last?.dividend_yield ?? null, date: last?.date,
      perPercentile: percentile(rows.map(r => r.PER).filter(v => v > 0), last?.PER),
      pbrPercentile: percentile(rows.map(r => r.PBR).filter(v => v > 0), last?.PBR),
      perMin: Math.min(...rows.map(r => r.PER).filter(v => v > 0)), perMax: Math.max(...rows.map(r => r.PER)),
    };
  }
  if (info.status === 'fulfilled' && info.value.length) {
    out.profile = { industry: [...new Set(info.value.map(r => r.industry_category))].join('、'), name: info.value[0].stock_name, type: info.value[0].type === 'tpex' ? '上櫃' : '上市' };
  }
  if (fin.status === 'fulfilled' && fin.value.length) {
    const byDate = new Map();
    const pick = { Revenue: 'revenue', GrossProfit: 'grossProfit', OperatingIncome: 'opIncome', IncomeAfterTaxes: 'netIncome', EPS: 'eps' };
    for (const r of fin.value) if (pick[r.type]) {
      const row = byDate.get(r.date) || { date: r.date };
      row[pick[r.type]] = r.value;
      byDate.set(r.date, row);
    }
    out.twQuarterly = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

// ---------- Nasdaq（美股） ----------
export const NQ_HEADERS = { Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
export const nasdaq = path => cached(`nq:${path}`, 30 * 60_000, () => getJSON(`https://api.nasdaq.com/api/${path}`, NQ_HEADERS));

async function usExtras(symbol) {
  const [sum, rat] = await Promise.allSettled([
    nasdaq(`quote/${symbol}/summary?assetClass=stocks`),
    nasdaq(`analyst/${symbol}/ratings`),
  ]);
  const out = {};
  const s = sum.status === 'fulfilled' ? sum.value?.data?.summaryData : null;
  if (s) {
    const v = k => s[k]?.value;
    out.profile = { sector: v('Sector'), industry: v('Industry'), exchange: v('Exchange') };
    out.analyst = { target: num(v('OneYrTarget')) };
    out.dividend = { annual: num(v('AnnualizedDividend')), yield: num(v('Yield')), exDate: v('ExDividendDate'), payDate: v('DividendPaymentDate') };
  }
  const r = rat.status === 'fulfilled' ? rat.value?.data : null;
  if (r) { out.analyst = { ...(out.analyst || {}), rating: r.meanRatingType, summary: r.ratingsSummary }; }
  return out;
}

// ---------- 組合 ----------
export function fundamentals(symbol) {
  return cached(`fund:${symbol}`, 30 * 60_000, async () => {
    const tw = isTW(symbol), code = symbol.split('.')[0];
    const [yf, extra] = await Promise.all([
      yahooFundamentals(symbol).catch(() => ({})),
      (tw ? twExtras(code) : usExtras(symbol)).catch(() => ({})),
    ]);
    const last = k => yf[k]?.[yf[k].length - 1]?.value ?? null;

    // 季度財報（以日期對齊）
    const qKeys = { revenue: 'quarterlyTotalRevenue', grossProfit: 'quarterlyGrossProfit', opIncome: 'quarterlyOperatingIncome', netIncome: 'quarterlyNetIncome',
      eps: 'quarterlyDilutedEPS', ocf: 'quarterlyOperatingCashFlow', fcf: 'quarterlyFreeCashFlow' };
    const fmQ = new Map((extra.twQuarterly || []).map(r => [r.date, r]));
    const dates = [...new Set([...Object.values(qKeys).flatMap(k => (yf[k] || []).map(x => x.date)), ...fmQ.keys()])].sort();
    const quarterly = dates.map(date => {
      const row = { date };
      for (const [f, k] of Object.entries(qKeys)) row[f] = fmQ.get(date)?.[f] ?? yf[k]?.find(x => x.date === date)?.value ?? null;
      if (row.revenue) {
        row.grossMargin = row.grossProfit != null ? row.grossProfit / row.revenue * 100 : null;
        row.opMargin = row.opIncome != null ? row.opIncome / row.revenue * 100 : null;
        row.netMargin = row.netIncome != null ? row.netIncome / row.revenue * 100 : null;
      }
      return row;
    });
    const aKeys = { revenue: 'annualTotalRevenue', netIncome: 'annualNetIncome', eps: 'annualDilutedEPS', fcf: 'annualFreeCashFlow', grossProfit: 'annualGrossProfit', opIncome: 'annualOperatingIncome' };
    const aDates = [...new Set(Object.values(aKeys).flatMap(k => (yf[k] || []).map(x => x.date)))].sort();
    const annual = aDates.map(date => {
      const row = { date };
      for (const [f, k] of Object.entries(aKeys)) row[f] = yf[k]?.find(x => x.date === date)?.value ?? null;
      if (row.revenue) { row.grossMargin = row.grossProfit != null ? row.grossProfit / row.revenue * 100 : null; row.netMargin = row.netIncome != null ? row.netIncome / row.revenue * 100 : null; }
      return row;
    });

    // 成長：最新一季 vs 去年同季、上一季
    const q = quarterly.filter(r => r.revenue != null);
    const change = (a, b) => a != null && b ? (a - b) / Math.abs(b) * 100 : null;
    const yoy = key => {
      const rows = quarterly.filter(r => r[key] != null);
      const l = rows[rows.length - 1];
      const y = l && rows.find(r => Math.abs(new Date(l.date) - new Date(r.date) - 365 * 86400000) < 40 * 86400000);
      return y ? change(l[key], y[key]) : null;
    };
    const qoq = key => { const rows = quarterly.filter(r => r[key] != null); return change(rows[rows.length - 1]?.[key], rows[rows.length - 2]?.[key]); };
    const growth = { revenueYoY: yoy('revenue'), epsYoY: yoy('eps'), netIncomeYoY: yoy('netIncome'), revenueQoQ: qoq('revenue'), epsQoQ: qoq('eps') };

    // 財務體質
    const equity = last('quarterlyStockholdersEquity'), debt = last('quarterlyTotalDebt'), assets = last('quarterlyTotalAssets');
    const ttmNI = last('trailingNetIncome') ?? (q.length >= 4 ? q.slice(-4).reduce((a, r) => a + (r.netIncome || 0), 0) : null);
    const shares = last('quarterlyOrdinarySharesNumber');
    const health = {
      equity, totalDebt: debt, cash: last('quarterlyCashAndCashEquivalents'), totalAssets: assets, shares,
      currentRatio: last('quarterlyCurrentAssets') && last('quarterlyCurrentLiabilities') ? last('quarterlyCurrentAssets') / last('quarterlyCurrentLiabilities') : null,
      debtToEquity: equity && debt != null ? debt / equity * 100 : null,
      roe: equity && ttmNI != null ? ttmNI / equity * 100 : null,
      roa: assets && ttmNI != null ? ttmNI / assets * 100 : null,
      bookValuePerShare: equity && shares ? equity / shares : null,
      ttmRevenue: last('trailingTotalRevenue'), ttmNetIncome: ttmNI, ttmEps: last('trailingDilutedEPS') ?? (q.length >= 4 ? q.slice(-4).reduce((a, r) => a + (r.eps || 0), 0) : null),
      ttmFcf: q.length >= 4 ? q.slice(-4).reduce((a, r) => a + (r.fcf || 0), 0) : null,
    };

    const valuation = {
      pe: extra.twValuation?.per || last('trailingPeRatio'), forwardPe: last('trailingForwardPeRatio'),
      pb: extra.twValuation?.pbr || last('trailingPbRatio'), ps: last('trailingPsRatio'), peg: last('trailingPegRatio'),
      evEbitda: last('trailingEnterprisesValueEBITDARatio'), marketCap: last('trailingMarketCap'),
      dividendYield: extra.twValuation?.yield ?? extra.dividend?.yield ?? null,
      perPercentile: extra.twValuation?.perPercentile ?? null, pbrPercentile: extra.twValuation?.pbrPercentile ?? null,
      perRange: extra.twValuation ? [extra.twValuation.perMin, extra.twValuation.perMax] : null,
      peHistory: (yf.trailingPeRatio || []).map(x => ({ date: x.date, per: x.value })),
    };

    return {
      symbol, market: tw ? 'tw' : 'us', currency: yf._currency || (tw ? 'TWD' : 'USD'),
      profile: extra.profile || {}, valuation, quarterly: quarterly.slice(-12), annual: annual.slice(-5), growth, health,
      monthlyRevenue: extra.monthlyRevenue || null, dividends: extra.dividends || null, perHistory: extra.perHistory || null,
      analyst: extra.analyst || null, dividend: extra.dividend || null,
    };
  });
}
