// 技術指標計算（輸入 K 棒陣列 [{t,o,h,l,c,v}]，全部在伺服器算好）
// 均線 / 布林通道 / RSI / MACD / KD / ATR / 乖離率 / OBV，並產生多空訊號與支撐壓力

const round = (v, d = 4) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

export function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(arr, n) {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    if (prev == null) {
      if (i < n - 1) continue;
      prev = arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n; // 以 SMA 起算
    } else prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function stdev(arr, n, means) {
  return arr.map((_, i) => {
    if (means[i] == null) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (arr[j] - means[i]) ** 2;
    return Math.sqrt(s / n);
  });
}

export function bollinger(close, n = 20, k = 2) {
  const mid = sma(close, n), sd = stdev(close, n, mid);
  const upper = mid.map((m, i) => m == null ? null : m + k * sd[i]);
  const lower = mid.map((m, i) => m == null ? null : m - k * sd[i]);
  const pctB = close.map((c, i) => upper[i] == null || upper[i] === lower[i] ? null : (c - lower[i]) / (upper[i] - lower[i]));
  const width = mid.map((m, i) => m ? (upper[i] - lower[i]) / m * 100 : null);
  return { mid, upper, lower, pctB, width };
}

// Wilder RSI
export function rsi(close, n = 14) {
  const out = new Array(close.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      gain += g; loss += l;
      if (i === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

// MACD：DIF = EMA12 − EMA26，DEA(訊號線) = EMA9(DIF)，柱狀體 = DIF − DEA
export function macd(close, fast = 12, slow = 26, signal = 9) {
  const ef = ema(close, fast), es = ema(close, slow);
  const dif = close.map((_, i) => ef[i] == null || es[i] == null ? null : ef[i] - es[i]);
  const firstIdx = dif.findIndex(v => v != null);
  const deaPart = firstIdx < 0 ? [] : ema(dif.slice(firstIdx), signal);
  const dea = dif.map((_, i) => i < firstIdx || firstIdx < 0 ? null : deaPart[i - firstIdx]);
  const hist = dif.map((d, i) => d == null || dea[i] == null ? null : d - dea[i]);
  return { dif, dea, hist };
}

// 台灣常用 KD(9,3,3)：RSV → K = 2/3·K前 + 1/3·RSV，D = 2/3·D前 + 1/3·K
export function kd(high, low, close, n = 9) {
  const K = new Array(close.length).fill(null), D = new Array(close.length).fill(null), J = new Array(close.length).fill(null);
  let k = 50, d = 50;
  for (let i = n - 1; i < close.length; i++) {
    const hh = Math.max(...high.slice(i - n + 1, i + 1)), ll = Math.min(...low.slice(i - n + 1, i + 1));
    const rsv = hh === ll ? 50 : (close[i] - ll) / (hh - ll) * 100;
    k = k * 2 / 3 + rsv / 3; d = d * 2 / 3 + k / 3;
    K[i] = k; D[i] = d; J[i] = 3 * k - 2 * d;
  }
  return { k: K, d: D, j: J };
}

export function atr(high, low, close, n = 14) {
  const tr = close.map((c, i) => i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  const out = new Array(close.length).fill(null);
  let prev = null;
  for (let i = 0; i < tr.length; i++) {
    if (i === n - 1) prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = i >= n - 1 ? prev : null;
  }
  return out;
}

export function obv(close, vol) {
  let v = 0;
  return close.map((c, i) => { if (i > 0) v += c > close[i - 1] ? vol[i] : c < close[i - 1] ? -vol[i] : 0; return v; });
}

// 轉成週K / 月K
export function resample(bars, tf) {
  if (tf === 'D') return bars;
  const key = t => {
    const d = new Date(t * 1000);
    if (tf === 'M') return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    return monday.toISOString().slice(0, 10);
  };
  const out = [];
  let cur = null, curKey = null;
  for (const b of bars) {
    const k = key(b.t);
    if (k !== curKey) { if (cur) out.push(cur); cur = { ...b }; curKey = k; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  if (cur) out.push(cur);
  return out;
}

// 支撐 / 壓力：前一根的樞紐點 + 近期波段高低點（5 根分形）
function levels(bars, price) {
  const last = bars[bars.length - 2] || bars[bars.length - 1];
  const P = (last.h + last.l + last.c) / 3;
  const pivots = { P, R1: 2 * P - last.l, S1: 2 * P - last.h, R2: P + (last.h - last.l), S2: P - (last.h - last.l) };
  const recent = bars.slice(-120);
  const highs = [], lows = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const b = recent[i];
    if (b.h >= Math.max(recent[i - 1].h, recent[i - 2].h, recent[i + 1].h, recent[i + 2].h)) highs.push(b.h);
    if (b.l <= Math.min(recent[i - 1].l, recent[i - 2].l, recent[i + 1].l, recent[i + 2].l)) lows.push(b.l);
  }
  const resistance = [...new Set(highs.filter(h => h > price).sort((a, b) => a - b))].slice(0, 3);
  const support = [...new Set(lows.filter(l => l < price).sort((a, b) => b - a))].slice(0, 3);
  return { pivots, resistance, support };
}

// 產生訊號（bull / bear / info），最後統計多空分數
function signals(bars, ind) {
  const n = bars.length - 1, c = bars[n].c, out = [];
  const add = (type, text) => out.push({ type, text });
  const at = (arr, i = n) => arr[i];
  const crossUp = (a, b, within = 3) => { for (let i = n; i > n - within && i > 0; i--) if (a[i - 1] != null && b[i - 1] != null && a[i - 1] <= b[i - 1] && a[i] > b[i]) return n - i; return -1; };
  const crossDown = (a, b, within = 3) => { for (let i = n; i > n - within && i > 0; i--) if (a[i - 1] != null && b[i - 1] != null && a[i - 1] >= b[i - 1] && a[i] < b[i]) return n - i; return -1; };
  const ago = k => k === 0 ? '今日' : `${k} 根前`;
  const { ma5, ma10, ma20, ma60, ma240 } = ind.ma;

  // 均線排列
  if (at(ma5) && at(ma20) && at(ma60)) {
    if (c > at(ma5) && at(ma5) > at(ma20) && at(ma20) > at(ma60)) add('bull', '均線多頭排列（價 > 5MA > 20MA > 60MA）');
    else if (c < at(ma5) && at(ma5) < at(ma20) && at(ma20) < at(ma60)) add('bear', '均線空頭排列（價 < 5MA < 20MA < 60MA）');
  }
  if (at(ma20)) add(c > at(ma20) ? 'bull' : 'bear', `股價${c > at(ma20) ? '站上' : '跌破'}月線（20MA ${round(at(ma20), 2)}）`);
  if (at(ma60)) add(c > at(ma60) ? 'bull' : 'bear', `股價${c > at(ma60) ? '站上' : '跌破'}季線（60MA ${round(at(ma60), 2)}）`);
  if (at(ma240)) add(c > at(ma240) ? 'bull' : 'bear', `股價${c > at(ma240) ? '位於' : '低於'}年線（240MA ${round(at(ma240), 2)}）之${c > at(ma240) ? '上' : '下'}`);
  let k;
  if ((k = crossUp(ma5, ma20)) >= 0) add('bull', `5MA 上穿 20MA 黃金交叉（${ago(k)}）`);
  if ((k = crossDown(ma5, ma20)) >= 0) add('bear', `5MA 下穿 20MA 死亡交叉（${ago(k)}）`);

  // MACD
  const { dif, dea, hist } = ind.macd;
  if ((k = crossUp(dif, dea)) >= 0) add('bull', `MACD 黃金交叉（${ago(k)}）`);
  if ((k = crossDown(dif, dea)) >= 0) add('bear', `MACD 死亡交叉（${ago(k)}）`);
  if (at(hist) != null && at(hist, n - 1) != null) {
    if (at(hist) > 0) add('bull', `MACD 柱狀體為正${at(hist) > at(hist, n - 1) ? '且擴大' : '但收斂'}`);
    else add('bear', `MACD 柱狀體為負${at(hist) < at(hist, n - 1) ? '且擴大' : '但收斂'}`);
  }

  // KD
  const K = ind.kd.k, D = ind.kd.d;
  if ((k = crossUp(K, D)) >= 0) add('bull', `KD 黃金交叉${at(K) < 30 ? '（低檔）' : ''}（${ago(k)}，K=${round(at(K), 1)}）`);
  if ((k = crossDown(K, D)) >= 0) add('bear', `KD 死亡交叉${at(K) > 70 ? '（高檔）' : ''}（${ago(k)}，K=${round(at(K), 1)}）`);
  if (at(K) > 80) add('info', `KD 高檔鈍化區（K=${round(at(K), 1)}），留意過熱`);
  if (at(K) < 20) add('info', `KD 低檔區（K=${round(at(K), 1)}），留意反彈`);

  // RSI
  const r = at(ind.rsi14);
  if (r != null) {
    if (r > 70) add('info', `RSI ${round(r, 1)} 超買`);
    else if (r < 30) add('info', `RSI ${round(r, 1)} 超賣`);
    else add(r >= 50 ? 'bull' : 'bear', `RSI ${round(r, 1)}，${r >= 50 ? '多方' : '空方'}佔優`);
  }

  // 布林通道
  const bb = ind.bb;
  if (at(bb.upper) && c > at(bb.upper)) add('info', '收盤突破布林上軌（強勢，但短線乖離大）');
  if (at(bb.lower) && c < at(bb.lower)) add('info', '收盤跌破布林下軌（弱勢，但短線乖離大）');
  if (at(bb.width) != null) {
    const widths = bb.width.slice(-120).filter(v => v != null);
    if (widths.length > 20 && at(bb.width) <= Math.min(...widths) * 1.05) add('info', '布林通道寬度收斂至近半年低點，可能醞釀變盤');
  }

  // 量能
  const vma = at(ind.volMa20);
  if (vma && bars[n].v > vma * 2) add(c >= bars[n - 1].c ? 'bull' : 'bear', `爆量 ${round(bars[n].v / vma, 1)} 倍（相對 20 日均量）${c >= bars[n - 1].c ? '收紅' : '收黑'}`);
  else if (vma && bars[n].v < vma * 0.5) add('info', '量縮至 20 日均量一半以下');

  // 52 週 / 區間新高新低
  const look = bars.slice(-250);
  const hi = Math.max(...look.map(b => b.h)), lo = Math.min(...look.map(b => b.l));
  if (bars[n].h >= hi) add('bull', '創近一年新高');
  if (bars[n].l <= lo) add('bear', '創近一年新低');

  const bull = out.filter(s => s.type === 'bull').length, bear = out.filter(s => s.type === 'bear').length;
  const score = bull + bear ? Math.round((bull - bear) / (bull + bear) * 100) : 0;
  const verdict = score >= 50 ? '強勢偏多' : score >= 15 ? '偏多' : score <= -50 ? '弱勢偏空' : score <= -15 ? '偏空' : '中性整理';
  return { list: out, bull, bear, score, verdict, high52: hi, low52: lo };
}

export function analyze(bars) {
  const close = bars.map(b => b.c), high = bars.map(b => b.h), low = bars.map(b => b.l), vol = bars.map(b => b.v);
  const ma = {};
  for (const n of [5, 10, 20, 60, 120, 240]) ma['ma' + n] = sma(close, n);
  const ind = {
    ma,
    bb: bollinger(close),
    rsi14: rsi(close, 14),
    rsi6: rsi(close, 6),
    macd: macd(close),
    kd: kd(high, low, close),
    atr14: atr(high, low, close),
    obv: obv(close, vol),
    volMa20: sma(vol, 20),
    volMa5: sma(vol, 5),
  };
  ind.bias20 = close.map((c, i) => ma.ma20[i] ? (c - ma.ma20[i]) / ma.ma20[i] * 100 : null);
  ind.bias60 = close.map((c, i) => ma.ma60[i] ? (c - ma.ma60[i]) / ma.ma60[i] * 100 : null);

  const n = bars.length - 1, price = close[n];
  const sig = signals(bars, ind);
  const lv = levels(bars, price);
  const last = (arr) => round(arr[n], 4);
  const snapshot = {
    price, ma5: last(ma.ma5), ma10: last(ma.ma10), ma20: last(ma.ma20), ma60: last(ma.ma60), ma120: last(ma.ma120), ma240: last(ma.ma240),
    rsi14: last(ind.rsi14), rsi6: last(ind.rsi6), k: last(ind.kd.k), d: last(ind.kd.d), j: last(ind.kd.j),
    dif: last(ind.macd.dif), dea: last(ind.macd.dea), hist: last(ind.macd.hist),
    bbUpper: last(ind.bb.upper), bbMid: last(ind.bb.mid), bbLower: last(ind.bb.lower), bbPctB: last(ind.bb.pctB), bbWidth: last(ind.bb.width),
    atr14: last(ind.atr14), atrPct: ind.atr14[n] ? round(ind.atr14[n] / price * 100, 2) : null,
    bias20: last(ind.bias20), bias60: last(ind.bias60), volMa5: last(ind.volMa5), volMa20: last(ind.volMa20),
  };
  // 序列四捨五入以縮小傳輸量
  const ser = arr => arr.map(v => round(v, 4));
  return {
    snapshot, signals: sig, levels: lv,
    series: {
      ma5: ser(ma.ma5), ma10: ser(ma.ma10), ma20: ser(ma.ma20), ma60: ser(ma.ma60), ma120: ser(ma.ma120), ma240: ser(ma.ma240),
      bbUpper: ser(ind.bb.upper), bbMid: ser(ind.bb.mid), bbLower: ser(ind.bb.lower),
      rsi14: ser(ind.rsi14), rsi6: ser(ind.rsi6), k: ser(ind.kd.k), d: ser(ind.kd.d),
      dif: ser(ind.macd.dif), dea: ser(ind.macd.dea), hist: ser(ind.macd.hist),
      bias20: ser(ind.bias20), bias60: ser(ind.bias60), obv: ind.obv, volMa20: ser(ind.volMa20),
    },
  };
}
