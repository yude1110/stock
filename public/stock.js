// 個股分析頁：技術面（K 線 + 指標）、基本面、籌碼面、消息面、下單（Broker Adapter）
const params = new URLSearchParams(location.search);
let SYM = (params.get('symbol') || store.get('lastSymbol', '2330.TW')).trim().toUpperCase();
if (/^\d{4,6}[A-Z]?$/.test(SYM)) SYM += '.TW';
store.set('lastSymbol', SYM);
const TW = isTW(SYM);
const enc = encodeURIComponent;
const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();
const S = { quote: null, tech: null, techD: null, fund: null, chips: null, account: null, name: '' };

// ---------- 小工具 ----------
const f2 = (v, d = 2) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const pctPlain = (v, d = 2) => v == null || !isFinite(v) ? '—' : Number(v).toFixed(d) + '%';
const lots = v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString() + ' 張';
const money = v => v == null || !isFinite(v) ? '—' : big(Math.abs(v)) === '—' ? '0' : (v < 0 ? '-' : '') + big(Math.abs(v));
const qLabel = d => { const x = new Date(d); return `${x.getUTCFullYear()}Q${Math.floor(x.getUTCMonth() / 3) + 1}`; };
const cell = (label, value, extra = '', c = '') => `<div class="cell"><span>${label}</span><b class="${c}">${value}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
const kc = (label, value, small = '', c = '', barPct = null) => `<div class="kc"><span>${label}</span><b class="${c}">${value}</b>${small ? `<small>${small}</small>` : ''}${barPct != null ? `<div class="pbar"><i style="width:${Math.max(2, Math.min(100, barPct))}%"></i></div>` : ''}</div>`;
const curSym = () => TW ? 'NT$' : '$';

// ================= 報價 + 標頭 =================
async function loadQuote() {
  const q = await api(`/api/chart?symbol=${enc(SYM)}&range=1d`);
  S.quote = q;
  S.name = S.name || q.name || SYM;
  document.title = `${TW ? short(SYM) + ' ' : ''}${S.name}${TW ? '' : ' ' + SYM} | 個股分析`;
  $('#qSym').textContent = TW ? short(SYM) : SYM;
  $('#qName').textContent = S.name;
  $('#qPx').innerHTML = num('px', q.price, 'p');
  $('#qPx').className = 'px ' + cls(q.change);
  $('#qChg').className = 'chg ' + cls(q.change);
  $('#qChg').innerHTML = `${fmtChg(q.change)} (${fmtPct(q.changePct)})${q.limitUp ? ' <span class="tag lu">漲停</span>' : q.limitDown ? ' <span class="tag ld">跌停</span>' : ''}`;
  animateNums($('.q-title'));
  $('#updated').textContent = '報價 ' + new Date().toLocaleTimeString('zh-TW', { hour12: false });
  if (!$('#oPrice').dataset.touched) $('#oPrice').value = q.price;
  renderStrip(); updateEstimate();
}

function marketState() {
  const now = new Date();
  if (TW) {
    const t = new Date(now.getTime() + 8 * 3600_000), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
    return d > 0 && d < 6 && m >= 540 && m <= 810 ? ['台股 盤中', true] : ['台股 已收盤', false];
  }
  const t = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })), d = t.getDay(), m = t.getHours() * 60 + t.getMinutes();
  if (d === 0 || d === 6) return ['美股 休市', false];
  if (m >= 570 && m < 960) return ['美股 盤中', true];
  if (m >= 240 && m < 570) return ['美股 盤前', true];
  if (m >= 960 && m < 1200) return ['美股 盤後', true];
  return ['美股 休市', false];
}

function renderStrip() {
  const q = S.quote || {}, f = S.fund, t = S.techD, c = S.chips;
  const series = q.series || [];
  const open = q.open ?? series[0]?.o, hi = q.dayHigh, lo = q.dayLow;
  const v = f?.valuation || {}, h = f?.health || {};
  const cells = [
    cell('開盤', fmtP(open)), cell('最高', fmtP(hi), '', 'up'), cell('最低', fmtP(lo), '', 'down'), cell('昨收', fmtP(q.prevClose)),
    cell('成交量', vol(q.volume, SYM)), cell('振幅', q.prevClose && hi && lo ? pctPlain((hi - lo) / q.prevClose * 100) : '—'),
    cell('52 週高', fmtP(t?.signals?.high52), t && q.price ? pct((q.price / t.signals.high52 - 1) * 100) + ' 距高點' : ''),
    cell('52 週低', fmtP(t?.signals?.low52), t && q.price ? pct((q.price / t.signals.low52 - 1) * 100) + ' 距低點' : ''),
    cell('市值', v.marketCap ? big(v.marketCap) : '—'),
    cell('本益比', f2(v.pe), v.perPercentile != null ? `近三年位階 ${v.perPercentile}%` : ''),
    cell('預估本益比', f2(v.forwardPe)),
    cell('股價淨值比', f2(v.pb), v.pbrPercentile != null ? `位階 ${v.pbrPercentile}%` : ''),
    cell('殖利率', v.dividendYield != null ? pctPlain(v.dividendYield) : '—'),
    cell('EPS (TTM)', f2(h.ttmEps)), cell('ROE (TTM)', pctPlain(h.roe), '', h.roe > 15 ? 'up' : ''),
  ];
  if (TW && c) {
    cells.push(cell('外資持股', c.foreignHolding?.latest ? pctPlain(c.foreignHolding.latest.ratio) : '—', c.foreignHolding?.chg20 != null ? `20日 ${pct(c.foreignHolding.chg20)}` : ''));
    cells.push(cell('外資連續', c.institutional ? streakTxt(c.institutional.streak.foreign) : '—', '', cls(c.institutional?.streak.foreign)));
    cells.push(cell('投信連續', c.institutional ? streakTxt(c.institutional.streak.trust) : '—', '', cls(c.institutional?.streak.trust)));
    cells.push(cell('當沖率', c.dayTrading?.latest ? pctPlain(c.dayTrading.latest.ratio, 1) : '—', c.dayTrading?.avg20 ? `20日均 ${pctPlain(c.dayTrading.avg20, 1)}` : ''));
  }
  if (!TW && c) {
    cells.push(cell('機構持股', c.institutional?.ownershipPct != null ? pctPlain(c.institutional.ownershipPct) : '—'));
    const si = c.shortInterest?.[c.shortInterest.length - 1];
    cells.push(cell('空單回補天數', si ? f2(si.daysToCover) : '—', si ? `放空 ${big(si.interest)} 股` : ''));
  }
  if (!TW && f?.analyst?.target) cells.push(cell('分析師目標價', '$' + f2(f.analyst.target), q.price ? `空間 ${pct((f.analyst.target / q.price - 1) * 100)}` : '', f.analyst.target > q.price ? 'up' : 'down'));
  $('#strip').innerHTML = cells.join('');
}
const streakTxt = n => !n ? '—' : `${n > 0 ? '連買' : '連賣'} ${Math.abs(n)} 日`;

function renderTags() {
  const p = S.fund?.profile || {};
  const tags = TW ? [p.type || (SYM.endsWith('.TWO') ? '上櫃' : '上市'), p.industry, 'TWD'] : [p.exchange, p.sector, p.industry, 'USD'];
  $('#qTags').innerHTML = tags.filter(Boolean).map(t => `<span class="tag2">${esc(t)}</span>`).join('');
}

// 自選股（與儀表板共用）
function renderStar() {
  const w = store.get('watchlist2', []);
  const on = w.includes(SYM);
  $('#starBtn').textContent = on ? '★ 已加入自選' : '☆ 加入自選';
  $('#starBtn').classList.toggle('on', on);
}
$('#starBtn').onclick = () => {
  let w = store.get('watchlist2', []);
  w = w.includes(SYM) ? w.filter(s => s !== SYM) : [...w, SYM];
  store.set('watchlist2', w); renderStar();
};

// ================= K 線圖 =================
const LC = window.LightweightCharts;
const MA = { ma5: ['5MA', '#ffc94d'], ma10: ['10MA', '#ff8ad8'], ma20: ['20MA', '#5bc0ff'], ma60: ['60MA', '#b98cff'], ma120: ['120MA', '#ff9f5b'], ma240: ['240MA', '#7ee0a1'] };
let tf = 'D', sub = store.get('subInd', 'kd');
let maOn = store.get('maOn', { ma5: true, ma10: false, ma20: true, ma60: true, ma120: false, ma240: true });
let ovOn = store.get('ovOn', { bb: false, lv: true });
let main, subc, candle, volS, maS = {}, bbS = [], subS = [], lvLines = [], syncing = false, timeIdx = new Map();

function chartOpts(showTime) {
  return {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8a93a6', fontFamily: 'system-ui, "Microsoft JhengHei", sans-serif' },
    grid: { vertLines: { color: 'rgba(37,44,61,.45)' }, horzLines: { color: 'rgba(37,44,61,.45)' } },
    rightPriceScale: { borderColor: '#252c3d', minimumWidth: 72 },
    timeScale: { borderColor: '#252c3d', visible: showTime, rightOffset: 6, timeVisible: false },
    crosshair: { mode: LC.CrosshairMode.Normal },
    localization: { locale: 'zh-TW', priceFormatter: p => fmtP(p) },
  };
}

function initCharts() {
  if (!LC) { $('#mainChart').innerHTML = '<div class="empty">圖表元件載入失敗（需要網路連線載入 lightweight-charts）</div>'; return false; }
  main = LC.createChart($('#mainChart'), chartOpts(false));
  subc = LC.createChart($('#subChart'), chartOpts(true));
  const up = cssVar('--up'), down = cssVar('--down');
  candle = main.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineColor: '#5b8cff' });
  candle.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });
  volS = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  for (const [k, [, color]] of Object.entries(MA)) maS[k] = main.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: !!maOn[k] });
  bbS = ['bbUpper', 'bbMid', 'bbLower'].map((k, i) => main.addLineSeries({ color: i === 1 ? 'rgba(200,200,255,.5)' : 'rgba(200,200,255,.75)', lineWidth: 1, lineStyle: LC.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: ovOn.bb }));

  // 兩張圖時間軸、十字線同步
  const link = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange(r => { if (syncing || !r) return; syncing = true; b.timeScale().setVisibleLogicalRange(r); syncing = false; });
  link(main, subc); link(subc, main);
  // 十字線同步：用旗標避免兩張圖互相觸發造成迴圈
  let crossing = false;
  const SUBKEY = { kd: 'k', rsi: 'rsi14', macd: 'dif', bias: 'bias20', obv: 'obv' };
  main.subscribeCrosshairMove(p => {
    legend(p.time);
    if (crossing || !subS.length || !subc.setCrosshairPosition) return;
    crossing = true;
    const i = p.time != null ? timeIdx.get(p.time) : null;
    const v = i != null ? S.tech.series[SUBKEY[sub]][i] : null;
    if (v != null) subc.setCrosshairPosition(v, p.time, subS[sub === 'macd' ? 1 : 0]); else subc.clearCrosshairPosition();
    crossing = false;
  });
  subc.subscribeCrosshairMove(p => {
    legend(p.time);
    if (crossing || !main.setCrosshairPosition) return;
    crossing = true;
    const i = p.time != null ? timeIdx.get(p.time) : null;
    if (i != null) main.setCrosshairPosition(S.tech.bars[i].c, p.time, candle); else main.clearCrosshairPosition();
    crossing = false;
  });
  return true;
}

const line = (arr, bars) => arr.map((v, i) => v == null ? { time: bars[i].t } : { time: bars[i].t, value: v });

function drawTech(fit) {
  const t = S.tech; if (!t || !main) return;
  const bars = t.bars;
  timeIdx = new Map(bars.map((b, i) => [b.t, i]));
  const up = cssVar('--up'), down = cssVar('--down');
  candle.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
  candle.setData(bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
  volS.setData(bars.map((b, i) => ({ time: b.t, value: b.v, color: (b.c >= (i ? bars[i - 1].c : b.o) ? up : down) + '66' })));
  for (const k of Object.keys(MA)) maS[k].setData(line(t.series[k], bars));
  ['bbUpper', 'bbMid', 'bbLower'].forEach((k, i) => bbS[i].setData(line(t.series[k], bars)));
  drawLevels(); drawSub();
  if (fit) {
    const n = bars.length, show = tf === 'D' ? 140 : tf === 'W' ? 120 : 120;
    main.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - show), to: n + 4 });
  }
  legend(null);
}

function drawLevels() {
  lvLines.forEach(l => candle.removePriceLine(l)); lvLines = [];
  if (!ovOn.lv || !S.tech) return;
  const { pivots, resistance, support } = S.tech.levels;
  const add = (price, title, color, style = LC.LineStyle.Dotted) => lvLines.push(candle.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
  resistance.slice(0, 2).forEach((p, i) => add(p, '壓力' + (i + 1), 'rgba(255,77,94,.75)', LC.LineStyle.Dashed));
  support.slice(0, 2).forEach((p, i) => add(p, '支撐' + (i + 1), 'rgba(25,195,125,.75)', LC.LineStyle.Dashed));
  add(pivots.P, 'P', 'rgba(138,147,166,.6)');
}

function drawSub() {
  subS.forEach(s => subc.removeSeries(s)); subS = [];
  const t = S.tech; if (!t) return;
  const bars = t.bars, s = t.series;
  const L = (data, color, extra = {}) => { const x = subc.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, ...extra }); x.setData(line(data, bars)); subS.push(x); return x; };
  const guide = (series, v, color = 'rgba(138,147,166,.5)') => series.createPriceLine({ price: v, color, lineWidth: 1, lineStyle: LC.LineStyle.Dotted, axisLabelVisible: false });
  if (sub === 'kd') { const k = L(s.k, '#ffc94d'); L(s.d, '#5bc0ff'); guide(k, 80, 'rgba(255,77,94,.5)'); guide(k, 20, 'rgba(25,195,125,.5)'); }
  if (sub === 'rsi') { const r = L(s.rsi14, '#b98cff'); L(s.rsi6, '#ffc94d'); guide(r, 70, 'rgba(255,77,94,.5)'); guide(r, 30, 'rgba(25,195,125,.5)'); }
  if (sub === 'macd') {
    const up = cssVar('--up'), down = cssVar('--down');
    const h = subc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    h.setData(s.hist.map((v, i) => v == null ? { time: bars[i].t } : { time: bars[i].t, value: v, color: v >= 0 ? up + 'aa' : down + 'aa' }));
    subS.push(h); L(s.dif, '#ffc94d'); L(s.dea, '#5bc0ff');
  }
  if (sub === 'bias') { const b = L(s.bias20, '#5bc0ff'); L(s.bias60, '#b98cff'); guide(b, 0); }
  if (sub === 'obv') L(s.obv, '#7ee0a1', { priceFormat: { type: 'volume' } });
  const r = main.timeScale().getVisibleLogicalRange();
  if (r) subc.timeScale().setVisibleLogicalRange(r);
}

function legend(time) {
  const t = S.tech; if (!t) return;
  const i = time != null ? timeIdx.get(time) : t.bars.length - 1;
  if (i == null) return;
  const b = t.bars[i], prev = t.bars[i - 1];
  const chg = prev ? (b.c / prev.c - 1) * 100 : null;
  const d = new Date(b.t * 1000).toLocaleDateString('zh-TW', { timeZone: TW ? 'Asia/Taipei' : 'America/New_York' });
  const mas = Object.entries(MA).filter(([k]) => maOn[k] && t.series[k][i] != null).map(([k, [l, c]]) => `<span style="color:${c}">${l} ${fmtP(t.series[k][i])}</span>`).join('');
  $('#legend').innerHTML = `<span><i>${d}</i></span><span><i>開</i> ${fmtP(b.o)}</span><span><i>高</i> ${fmtP(b.h)}</span><span><i>低</i> ${fmtP(b.l)}</span>
    <span><i>收</i> <b class="${cls(chg)}">${fmtP(b.c)}</b> <span class="${cls(chg)}">${fmtPct(chg)}</span></span><span><i>量</i> ${vol(b.v, SYM)}</span>${mas}`;
  const s = t.series, v = (arr, dd = 2) => arr[i] == null ? '—' : f2(arr[i], dd);
  const SUB = {
    kd: `<span style="color:#ffc94d">K ${v(s.k)}</span><span style="color:#5bc0ff">D ${v(s.d)}</span>`,
    rsi: `<span style="color:#b98cff">RSI14 ${v(s.rsi14)}</span><span style="color:#ffc94d">RSI6 ${v(s.rsi6)}</span>`,
    macd: `<span style="color:#ffc94d">DIF ${v(s.dif)}</span><span style="color:#5bc0ff">MACD ${v(s.dea)}</span><span>OSC ${v(s.hist)}</span>`,
    bias: `<span style="color:#5bc0ff">乖離20 ${v(s.bias20)}%</span><span style="color:#b98cff">乖離60 ${v(s.bias60)}%</span>`,
    obv: `<span style="color:#7ee0a1">OBV ${big(s.obv[i])}</span>`,
  };
  $('#legend2').innerHTML = SUB[sub];
}

async function loadTech(fit = true) {
  const t = await api(`/api/stock/technical?symbol=${enc(SYM)}&tf=${tf}`);
  S.tech = t;
  if (tf === 'D') S.techD = t;
  S.name = S.name || t.name;
  drawTech(fit);
  renderSignals(); renderLevels(); renderIndicators(); renderStrip();
}

// 工具列
$('#maGrp').innerHTML = Object.entries(MA).map(([k, [l, c]]) => `<button data-ma="${k}" style="--c:${c}" class="${maOn[k] ? 'on' : ''}">${l}</button>`).join('');
$('#maGrp').onclick = e => {
  const k = e.target.dataset.ma; if (!k) return;
  maOn[k] = !maOn[k]; store.set('maOn', maOn);
  e.target.classList.toggle('on', maOn[k]); maS[k]?.applyOptions({ visible: maOn[k] }); legend(null);
};
document.querySelectorAll('#ovGrp button').forEach(b => b.classList.toggle('on', !!ovOn[b.dataset.ov]));
$('#ovGrp').onclick = e => {
  const k = e.target.dataset.ov; if (!k) return;
  ovOn[k] = !ovOn[k]; store.set('ovOn', ovOn); e.target.classList.toggle('on', ovOn[k]);
  if (k === 'bb') bbS.forEach(s => s.applyOptions({ visible: ovOn.bb }));
  if (k === 'lv') drawLevels();
};
document.querySelectorAll('#subGrp button').forEach(b => b.classList.toggle('on', b.dataset.sub === sub));
$('#subGrp').onclick = e => {
  const k = e.target.dataset.sub; if (!k) return;
  sub = k; store.set('subInd', k);
  document.querySelectorAll('#subGrp button').forEach(b => b.classList.toggle('on', b.dataset.sub === k));
  drawSub(); legend(null);
};
$('#tfGrp').onclick = e => {
  const k = e.target.dataset.tf; if (!k || k === tf) return;
  tf = k; document.querySelectorAll('#tfGrp button').forEach(b => b.classList.toggle('on', b.dataset.tf === k));
  $('#tfLbl').textContent = { D: '日K', W: '週K', M: '月K' }[k];
  loadTech(true).catch(err => toast('技術資料載入失敗：' + err.message));
};

// ---------- 技術面總評 / 支撐壓力 / 指標明細 ----------
function renderSignals() {
  const sg = S.tech.signals;
  $('#verdict').textContent = sg.verdict;
  $('#verdict').className = 'verdict ' + (sg.score > 15 ? 'up' : sg.score < -15 ? 'down' : '');
  $('#needle').style.left = (sg.score + 100) / 2 + '%';
  $('#bbCount').textContent = `多 ${sg.bull} · 空 ${sg.bear} · 分數 ${sg.score > 0 ? '+' : ''}${sg.score}`;
  const icon = { bull: '▲', bear: '▼', info: '◆' };
  $('#sigs').innerHTML = sg.list.map((s, i) => `<li class="${s.type}" style="--i:${i}"><span class="${s.type === 'bull' ? 'up' : s.type === 'bear' ? 'down' : ''}">${icon[s.type]}</span> ${esc(s.text)}</li>`).join('');
}

function renderLevels() {
  const { pivots, resistance, support } = S.tech.levels, price = S.quote?.price ?? S.tech.snapshot.price;
  const rows = [
    ...resistance.map((p, i) => ['壓力 ' + (i + 1), p]), ['R2', pivots.R2], ['R1', pivots.R1], ['樞紐 P', pivots.P], ['S1', pivots.S1], ['S2', pivots.S2],
    ...support.map((p, i) => ['支撐 ' + (i + 1), p]), ['現價', price, true],
  ].sort((a, b) => b[1] - a[1]);
  $('#levels').innerHTML = rows.map(([l, p, now]) => `<tr class="${now ? 'now' : ''}"><td>${l}</td><td class="num" style="text-align:right">${fmtP(p)}</td>
    <td class="num ${now ? '' : cls(p - price)}" style="text-align:right">${now ? '' : pct((p / price - 1) * 100)}</td></tr>`).join('');
}

function renderIndicators() {
  const s = S.tech.snapshot, c = s.price;
  const rows = [
    ['5MA / 10MA / 20MA', `${fmtP(s.ma5)} / ${fmtP(s.ma10)} / ${fmtP(s.ma20)}`, c > s.ma20 ? '站上月線' : '跌破月線'],
    ['60MA / 120MA / 240MA', `${fmtP(s.ma60)} / ${fmtP(s.ma120)} / ${fmtP(s.ma240)}`, s.ma240 ? (c > s.ma240 ? '年線之上（長多）' : '年線之下（長空）') : '資料不足'],
    ['KD (9)', `K ${f2(s.k)} / D ${f2(s.d)} / J ${f2(s.j)}`, s.k > 80 ? '高檔過熱區' : s.k < 20 ? '低檔超賣區' : s.k > s.d ? 'K > D 偏多' : 'K < D 偏空'],
    ['RSI', `RSI6 ${f2(s.rsi6)} / RSI14 ${f2(s.rsi14)}`, s.rsi14 > 70 ? '超買' : s.rsi14 < 30 ? '超賣' : s.rsi14 >= 50 ? '多方佔優' : '空方佔優'],
    ['MACD (12,26,9)', `DIF ${f2(s.dif)} / MACD ${f2(s.dea)} / OSC ${f2(s.hist)}`, s.dif > s.dea ? 'DIF 在訊號線上（偏多）' : 'DIF 在訊號線下（偏空）'],
    ['布林通道 (20,2)', `上 ${fmtP(s.bbUpper)} / 中 ${fmtP(s.bbMid)} / 下 ${fmtP(s.bbLower)}`, `%B ${f2(s.bbPctB * 100, 0)}%，帶寬 ${f2(s.bbWidth)}%`],
    ['ATR (14)', `${fmtP(s.atr14)}`, `日均波動 ${pctPlain(s.atrPct)}（停損可參考 1.5–2 倍 ATR）`],
    ['乖離率', `20日 ${pct(s.bias20)} / 60日 ${pct(s.bias60)}`, Math.abs(s.bias20) > 10 ? '短線乖離過大，留意回歸' : '乖離正常'],
    ['均量', `5日 ${vol(s.volMa5, SYM)} / 20日 ${vol(s.volMa20, SYM)}`, s.volMa5 > s.volMa20 * 1.3 ? '近期量增' : s.volMa5 < s.volMa20 * 0.7 ? '近期量縮' : '量能持平'],
  ];
  $('#pane-ind').innerHTML = `<div class="panel"><div class="scroll"><table class="dt"><thead><tr><th>指標</th><th style="text-align:left">數值（${{ D: '日K', W: '週K', M: '月K' }[tf]}）</th><th style="text-align:left">解讀</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td style="text-align:left">${r[1]}</td><td style="text-align:left">${r[2]}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">訊號為機械式規則判讀（均線、KD、MACD、RSI、布林、量能、新高新低），分數 = (多 − 空) / (多 + 空)。僅供參考。</p></div>`;
}

// ================= 簡易 SVG 圖（基本面 / 籌碼面用） =================
// 長條（左軸）+ 折線（右軸，選用）
function barLine(rows, { bar, line: ln, barFmt = big, lineFmt = v => pctPlain(v, 1), labels, h = 220, barColor }) {
  const W = 640, H = h, pl = 8, pr = 46, pt = 14, pb = 22;
  const vals = rows.map(r => r[bar] ?? 0), lv = ln ? rows.map(r => r[ln]).filter(v => v != null) : [];
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0), span = max - min || 1;
  const bw = (W - pl - pr) / rows.length;
  const y = v => pt + (max - v) / span * (H - pt - pb);
  const up = cssVar('--up'), down = cssVar('--down');
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="height:${H}px">`;
  svg += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="#252c3d"/>`;
  rows.forEach((r, i) => {
    const v = r[bar] ?? 0, x = pl + i * bw + bw * 0.15, top = Math.min(y(v), y(0)), hh = Math.abs(y(v) - y(0));
    const color = barColor ? barColor(r, v) : (v >= 0 ? '#5b8cff' : down);
    svg += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(1, hh).toFixed(1)}" fill="${color}" opacity=".85" rx="2"><title>${esc(labels[i])}：${barFmt(v)}</title></rect>`;
    if (rows.length <= 16 || i % Math.ceil(rows.length / 12) === 0) svg += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  if (lv.length) {
    const lmax = Math.max(...lv), lmin = Math.min(...lv), ls = lmax - lmin || 1;
    const ly = v => pt + (lmax - v) / ls * (H - pt - pb);
    const pts = rows.map((r, i) => r[ln] == null ? null : `${(pl + i * bw + bw / 2).toFixed(1)},${ly(r[ln]).toFixed(1)}`).filter(Boolean).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="#ffc94d" stroke-width="2"/>`;
    rows.forEach((r, i) => { if (r[ln] != null) svg += `<circle cx="${(pl + i * bw + bw / 2).toFixed(1)}" cy="${ly(r[ln]).toFixed(1)}" r="3" fill="#ffc94d"><title>${esc(labels[i])}：${lineFmt(r[ln])}</title></circle>`; });
    svg += `<text x="${W - pr + 4}" y="${pt + 4}" style="fill:#ffc94d">${lineFmt(lmax)}</text><text x="${W - pr + 4}" y="${H - pb}" style="fill:#ffc94d">${lineFmt(lmin)}</text>`;
  }
  svg += `<text x="${W - pr + 4}" y="${y(max) + 10}">${barFmt(max)}</text></svg>`;
  return `<div class="bars">${svg}</div>`;
}

// 多條折線（各自正規化或共用軸）
function lines(rows, keys, { h = 200, fmt = v => f2(v) } = {}) {
  const W = 640, H = h, pl = 8, pr = 56, pt = 12, pb = 22;
  const all = keys.flatMap(k => rows.map(r => r[k.key]).filter(v => v != null));
  if (!all.length) return '<div class="empty">無資料</div>';
  const max = Math.max(...all), min = Math.min(...all), span = max - min || 1;
  const x = i => pl + i / Math.max(1, rows.length - 1) * (W - pl - pr), y = v => pt + (max - v) / span * (H - pt - pb);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="height:${H}px">`;
  for (const k of keys) {
    const pts = rows.map((r, i) => r[k.key] == null ? null : `${x(i).toFixed(1)},${y(r[k.key]).toFixed(1)}`).filter(Boolean).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${k.color}" stroke-width="2"/>`;
  }
  svg += `<text x="${W - pr + 4}" y="${pt + 6}">${fmt(max)}</text><text x="${W - pr + 4}" y="${H - pb}">${fmt(min)}</text>`;
  [0, Math.floor(rows.length / 2), rows.length - 1].forEach(i => { if (rows[i]) svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}">${esc(rows[i].label || rows[i].date || '')}</text>`; });
  svg += '</svg>';
  const lg = keys.map(k => `<span style="color:${k.color}">● ${k.label}</span>`).join(' ');
  return `<div class="note" style="margin-bottom:4px">${lg}</div><div class="bars">${svg}</div>`;
}

// ================= 基本面 =================
async function loadFund() {
  S.fund = await api(`/api/stock/fundamental?symbol=${enc(SYM)}`);
  renderFund(); renderStrip(); renderTags();
}

function renderFund() {
  const f = S.fund, v = f.valuation, g = f.growth, h = f.health, price = S.quote?.price;
  let html = '';
  html += `<div class="sec"><h3>💰 估值</h3><div class="cards">
    ${kc('本益比 P/E', f2(v.pe), v.perPercentile != null ? `近三年位階 ${v.perPercentile}%（${f2(v.perRange?.[0], 1)}–${f2(v.perRange?.[1], 1)}）` : '', '', v.perPercentile)}
    ${kc('預估本益比', f2(v.forwardPe), v.pe && v.forwardPe ? (v.forwardPe < v.pe ? '低於目前 P/E：市場預期獲利成長' : '高於目前 P/E：預期獲利下滑') : '')}
    ${kc('股價淨值比 P/B', f2(v.pb), v.pbrPercentile != null ? `近三年位階 ${v.pbrPercentile}%` : '', '', v.pbrPercentile)}
    ${kc('股價營收比 P/S', f2(v.ps))}
    ${kc('PEG', f2(v.peg), v.peg ? (v.peg < 1 ? '< 1：相對成長偏便宜' : '> 1：相對成長偏貴') : '')}
    ${kc('EV / EBITDA', f2(v.evEbitda))}
    ${kc('殖利率', v.dividendYield != null ? pctPlain(v.dividendYield) : '—')}
    ${kc('市值', v.marketCap ? big(v.marketCap) : '—', f.currency)}
  </div></div>`;
  html += `<div class="sec"><h3>🚀 成長</h3><div class="cards">
    ${kc('營收 YoY（最新季）', pct(g.revenueYoY), '', cls(g.revenueYoY))}
    ${kc('營收 QoQ', pct(g.revenueQoQ), '', cls(g.revenueQoQ))}
    ${kc('EPS YoY', pct(g.epsYoY), '', cls(g.epsYoY))}
    ${kc('EPS QoQ', pct(g.epsQoQ), '', cls(g.epsQoQ))}
    ${kc('淨利 YoY', pct(g.netIncomeYoY), '', cls(g.netIncomeYoY))}
    ${f.monthlyRevenue?.length ? (() => { const m = f.monthlyRevenue[f.monthlyRevenue.length - 1]; return kc(`月營收 YoY（${m.ym}）`, pct(m.yoy), `累計 YoY ${pct(m.cumYoY)}`, cls(m.yoy)); })() : ''}
  </div></div>`;
  html += `<div class="sec"><h3>🏦 財務體質</h3><div class="cards">
    ${kc('ROE（TTM）', pctPlain(h.roe), h.roe > 15 ? '> 15%：獲利能力佳' : '', h.roe > 15 ? 'up' : '')}
    ${kc('ROA（TTM）', pctPlain(h.roa))}
    ${kc('負債 / 權益', pctPlain(h.debtToEquity), h.debtToEquity > 100 ? '財務槓桿偏高' : '')}
    ${kc('流動比率', f2(h.currentRatio), h.currentRatio < 1 ? '< 1：短期償債壓力' : '')}
    ${kc('每股淨值', f2(h.bookValuePerShare))}
    ${kc('EPS（TTM）', f2(h.ttmEps))}
    ${kc('自由現金流（TTM）', money(h.ttmFcf), '', cls(h.ttmFcf))}
    ${kc('現金 / 總負債', `${money(h.cash)} / ${money(h.totalDebt)}`)}
  </div></div>`;
  if (!TW && (f.analyst || f.dividend)) {
    const a = f.analyst || {}, d = f.dividend || {};
    html += `<div class="sec"><h3>🎯 分析師與股利</h3><div class="cards">
      ${kc('一年目標價', a.target ? '$' + f2(a.target) : '—', price && a.target ? `距現價 ${pct((a.target / price - 1) * 100)}` : '', a.target > price ? 'up' : 'down')}
      ${kc('平均評等', esc(a.rating || '—'), esc(a.summary || ''))}
      ${kc('年化股利', d.annual ? '$' + f2(d.annual) : '—', d.yield != null ? `殖利率 ${pctPlain(d.yield)}` : '')}
      ${kc('除息日', esc(d.exDate || '—'), d.payDate ? `發放 ${esc(d.payDate)}` : '')}
    </div></div>`;
  }
  // 季度財報
  const q = f.quarterly.filter(r => r.revenue != null);
  if (q.length) {
    const cols = [...q].reverse();
    const rowsDef = [
      ['營收', r => money(r.revenue)], ['毛利率', r => pctPlain(r.grossMargin)], ['營業利益率', r => pctPlain(r.opMargin)], ['淨利率', r => pctPlain(r.netMargin)],
      ['稅後淨利', r => money(r.netIncome)], ['EPS', r => f2(r.eps)], ['營業現金流', r => money(r.ocf)], ['自由現金流', r => money(r.fcf)],
    ];
    html += `<div class="sec"><h3>📑 季度財報 <small>單季數字，${f.currency}</small></h3><div class="two">
      <div class="panel">${barLine(q, { bar: 'revenue', line: 'grossMargin', labels: q.map(r => qLabel(r.date)) })}<div class="note">藍柱：營收　黃線：毛利率</div></div>
      <div class="panel">${barLine(q, { bar: 'eps', labels: q.map(r => qLabel(r.date)), barFmt: v => f2(v), barColor: (r, v) => v >= 0 ? cssVar('--up') : cssVar('--down') })}<div class="note">單季 EPS</div></div></div>
      <div class="panel scroll" style="margin-top:10px"><table class="dt"><thead><tr><th>項目</th>${cols.map(r => `<th>${qLabel(r.date)}</th>`).join('')}</tr></thead>
      <tbody>${rowsDef.map(([l, fn]) => `<tr><td>${l}</td>${cols.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }
  // 年度
  if (f.annual?.length) {
    const cols = [...f.annual].reverse();
    html += `<div class="sec"><h3>📅 年度</h3><div class="panel scroll"><table class="dt"><thead><tr><th>項目</th>${cols.map(r => `<th>${r.date.slice(0, 4)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>營收</td>${cols.map(r => `<td>${money(r.revenue)}</td>`).join('')}</tr>
      <tr><td>毛利率</td>${cols.map(r => `<td>${pctPlain(r.grossMargin)}</td>`).join('')}</tr>
      <tr><td>淨利</td>${cols.map(r => `<td>${money(r.netIncome)}</td>`).join('')}</tr>
      <tr><td>淨利率</td>${cols.map(r => `<td>${pctPlain(r.netMargin)}</td>`).join('')}</tr>
      <tr><td>EPS</td>${cols.map(r => `<td>${f2(r.eps)}</td>`).join('')}</tr>
      <tr><td>自由現金流</td>${cols.map(r => `<td>${money(r.fcf)}</td>`).join('')}</tr></tbody></table></div></div>`;
  }
  // 台股：月營收、股利、本益比歷史
  if (f.monthlyRevenue?.length) {
    const m = f.monthlyRevenue, last13 = m.slice(-13);
    html += `<div class="sec"><h3>📆 月營收 <small>台股每月 10 日前公布</small></h3><div class="two">
      <div class="panel">${barLine(last13, { bar: 'revenue', line: 'yoy', labels: last13.map(r => r.ym.slice(2)) })}<div class="note">藍柱：月營收　黃線：YoY</div></div>
      <div class="panel scroll"><table class="dt"><thead><tr><th>月份</th><th>營收</th><th>MoM</th><th>YoY</th><th>累計營收</th><th>累計 YoY</th></tr></thead><tbody>
      ${[...m].reverse().slice(0, 12).map(r => `<tr><td>${r.ym}</td><td>${money(r.revenue)}</td><td class="${cls(r.mom)}">${pct(r.mom)}</td><td class="${cls(r.yoy)}">${pct(r.yoy)}</td><td>${money(r.cum)}</td><td class="${cls(r.cumYoY)}">${pct(r.cumYoY)}</td></tr>`).join('')}
      </tbody></table></div></div></div>`;
  }
  if (f.perHistory?.length) {
    html += `<div class="sec"><h3>📉 本益比 / 淨值比 歷史 <small>近三年，判斷估值位階</small></h3><div class="two">
      <div class="panel">${lines(f.perHistory.map(r => ({ ...r, label: r.date.slice(0, 7) })), [{ key: 'per', label: '本益比', color: '#5bc0ff' }])}</div>
      <div class="panel">${lines(f.perHistory.map(r => ({ ...r, label: r.date.slice(0, 7) })), [{ key: 'pbr', label: '股價淨值比', color: '#b98cff' }])}</div></div></div>`;
  }
  if (f.dividends?.length) {
    html += `<div class="sec"><h3>💵 股利政策</h3><div class="panel scroll"><table class="dt"><thead><tr><th>期間</th><th>現金股利</th><th>股票股利</th><th>除息/權日</th><th>發放日</th><th>公告日</th></tr></thead><tbody>
      ${f.dividends.map(d => `<tr><td>${esc(d.period)}</td><td>${f2(d.cash, 2)}</td><td>${f2(d.stock, 2)}</td><td>${esc(d.exDate || '—')}</td><td>${esc(d.payDate || '—')}</td><td>${esc(d.announced || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  $('#pane-fund').innerHTML = html || '<div class="empty">此標的沒有基本面資料（ETF / 指數 / 加密貨幣通常沒有）</div>';
}

// ================= 籌碼面 =================
async function loadChips() {
  S.chips = await api(`/api/stock/chips?symbol=${enc(SYM)}`);
  TW ? renderChipsTW() : renderChipsUS();
  renderStrip();
}

function renderChipsTW() {
  const c = S.chips, inst = c.institutional, mg = c.margin, fh = c.foreignHolding, dt = c.dayTrading;
  if (!inst && !mg) { $('#pane-chips').innerHTML = '<div class="empty">查無籌碼資料（可能為 FinMind 免費額度用完，可設定 FINMIND_TOKEN）</div>'; return; }
  let html = '';
  if (inst) {
    const last = inst.rows[inst.rows.length - 1], s = inst.sums;
    html += `<div class="sec"><h3>🏛️ 三大法人買賣超 <small>單位：張　最新 ${esc(last.date)}</small></h3><div class="cards">
      ${kc('外資', lots(last.foreign), streakTxt(inst.streak.foreign), cls(last.foreign))}
      ${kc('投信', lots(last.trust), streakTxt(inst.streak.trust), cls(last.trust))}
      ${kc('自營商', lots(last.dealer), streakTxt(inst.streak.dealer), cls(last.dealer))}
      ${kc('三大法人合計', lots(last.total), '', cls(last.total))}
    </div>
    <div class="panel scroll" style="margin-bottom:10px"><table class="dt"><thead><tr><th>累計</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th></tr></thead><tbody>
      ${[1, 5, 20, 60].map(n => `<tr><td>近 ${n} 日</td>${['foreign', 'trust', 'dealer', 'total'].map(k => `<td class="${cls(s[n][k])}">${lots(s[n][k])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="panel"><div class="note" style="margin-bottom:4px"><span style="color:#5b8cff">■ 三大法人合計（日）</span>　<span style="color:#ffc94d">— 外資累計</span>　<span style="color:#ff8ad8">— 投信累計</span>　<span style="color:#e6e9ef">— 收盤價（右軸）</span></div><div id="instChart" class="mini" style="height:260px"></div></div></div>`;
  }
  if (mg?.latest) {
    const l = mg.latest;
    html += `<div class="sec"><h3>💳 融資融券 <small>最新 ${esc(l.date)}</small></h3><div class="cards">
      ${kc('融資餘額', Math.round(l.marginBal).toLocaleString() + ' 張', `今日 ${lots(l.marginChg)}　20日 ${lots(mg.marginChg20)}`, cls(l.marginChg))}
      ${kc('融資使用率', pctPlain(l.usage), l.usage > 30 ? '偏高：散戶追價' : '')}
      ${kc('融券餘額', Math.round(l.shortBal).toLocaleString() + ' 張', `今日 ${lots(l.shortChg)}　20日 ${lots(mg.shortChg20)}`, cls(l.shortChg))}
      ${kc('券資比', pctPlain(l.shortRatio), l.shortRatio > 30 ? '偏高：可能有軋空行情' : '')}
      ${kc('資券互抵（當沖）', (l.offset ?? 0).toLocaleString() + ' 張')}
    </div><div class="two">
      <div class="panel">${lines(mg.rows.map(r => ({ ...r, label: r.date.slice(5) })), [{ key: 'marginBal', label: '融資餘額（張）', color: '#ff9f5b' }], { fmt: v => Math.round(v).toLocaleString() })}</div>
      <div class="panel">${lines(mg.rows.map(r => ({ ...r, label: r.date.slice(5) })), [{ key: 'shortBal', label: '融券餘額（張）', color: '#7ee0a1' }], { fmt: v => Math.round(v).toLocaleString() })}</div>
    </div></div>`;
  }
  if (fh?.latest || dt?.latest) {
    html += `<div class="sec"><h3>🌐 外資持股 / 當沖</h3><div class="two">
      <div class="panel">${fh?.latest ? `<div class="cards">${kc('外資持股比率', pctPlain(fh.latest.ratio), `20日變化 ${pct(fh.chg20)}　上限 ${pctPlain(fh.latest.upperLimit, 0)}`, cls(fh.chg20))}</div>
        ${lines(fh.rows.map(r => ({ ...r, label: r.date.slice(5) })), [{ key: 'ratio', label: '外資持股 %', color: '#5bc0ff' }])}` : '<div class="empty">無資料</div>'}</div>
      <div class="panel">${dt?.latest ? `<div class="cards">${kc('當沖率', pctPlain(dt.latest.ratio, 1), `20日均 ${pctPlain(dt.avg20, 1)}　${dt.latest.ratio > 40 ? '當沖比重高：波動大' : ''}`)}</div>
        ${lines(dt.rows.map(r => ({ ...r, label: r.date.slice(5) })), [{ key: 'ratio', label: '當沖成交比重 %', color: '#ff8ad8' }])}` : '<div class="empty">無資料</div>'}</div>
    </div></div>`;
  }
  if (inst) {
    const mgMap = new Map((mg?.rows || []).map(r => [r.date, r])), fhMap = new Map((fh?.rows || []).map(r => [r.date, r]));
    html += `<div class="sec"><h3>🗓️ 每日籌碼明細 <small>近 20 個交易日</small></h3><div class="panel scroll"><table class="dt"><thead><tr><th>日期</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th><th>融資增減</th><th>融券增減</th><th>券資比</th><th>外資持股</th></tr></thead><tbody>
      ${[...inst.rows].reverse().slice(0, 20).map(r => { const m = mgMap.get(r.date), h = fhMap.get(r.date); return `<tr><td>${r.date}</td>
        <td class="${cls(r.foreign)}">${lots(r.foreign)}</td><td class="${cls(r.trust)}">${lots(r.trust)}</td><td class="${cls(r.dealer)}">${lots(r.dealer)}</td><td class="${cls(r.total)}">${lots(r.total)}</td>
        <td class="${cls(m?.marginChg)}">${m ? lots(m.marginChg) : '—'}</td><td class="${cls(m?.shortChg)}">${m ? lots(m.shortChg) : '—'}</td><td>${m ? pctPlain(m.shortRatio) : '—'}</td><td>${h ? pctPlain(h.ratio) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  }
  $('#pane-chips').innerHTML = html;
  if (inst && LC) drawInstChart();
}

let instChart = null;
function drawInstChart() {
  const el = $('#instChart'); if (!el) return;
  instChart?.remove();
  const o = chartOpts(true);
  instChart = LC.createChart(el, { ...o, leftPriceScale: { visible: true, borderColor: '#252c3d' }, localization: { ...o.localization, priceFormatter: v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : fmtP(v) } });
  const rows = S.chips.institutional.rows;
  const up = cssVar('--up'), down = cssVar('--down');
  const net = instChart.addHistogramSeries({ priceScaleId: 'net', priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } });
  instChart.priceScale('net').applyOptions({ scaleMargins: { top: 0.65, bottom: 0 } });
  net.setData(rows.map(r => ({ time: r.date, value: r.total, color: (r.total >= 0 ? up : down) + 'aa' })));
  let cf = 0, ct = 0;
  const cumF = rows.map(r => ({ time: r.date, value: (cf += r.foreign) })), cumT = rows.map(r => ({ time: r.date, value: (ct += r.trust) }));
  instChart.addLineSeries({ priceScaleId: 'left', color: '#ffc94d', lineWidth: 2, priceLineVisible: false, title: '外資累計' }).setData(cumF);
  instChart.addLineSeries({ priceScaleId: 'left', color: '#ff8ad8', lineWidth: 2, priceLineVisible: false, title: '投信累計' }).setData(cumT);
  instChart.priceScale('left').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.4 } });
  // 收盤價（右軸）：用日K資料對齊日期
  const bars = S.techD?.bars || [];
  const day = t => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);
  const closeMap = new Map(bars.map(b => [day(b.t), b.c]));
  const px = rows.filter(r => closeMap.has(r.date)).map(r => ({ time: r.date, value: closeMap.get(r.date) }));
  if (px.length) {
    const s = instChart.addLineSeries({ priceScaleId: 'right', color: '#e6e9ef', lineWidth: 1, priceLineVisible: false });
    s.setData(px); instChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.4 } });
  }
  instChart.timeScale().fitContent();
}

function renderChipsUS() {
  const c = S.chips, i = c.institutional, si = c.shortInterest, ins = c.insider;
  if (!i && !si && !ins) { $('#pane-chips').innerHTML = '<div class="empty">查無籌碼資料（ETF / 非美股標的可能沒有）</div>'; return; }
  let html = '';
  if (i) {
    html += `<div class="sec"><h3>🏛️ 機構持股 <small>13F 申報</small></h3><div class="cards">
      ${kc('機構持股比例', pctPlain(i.ownershipPct), `${(i.total?.holders || 0).toLocaleString()} 家機構`, '', i.ownershipPct)}
      ${kc('增持', `${(i.increased?.holders || 0).toLocaleString()} 家`, `${big(i.increased?.shares)} 股`, 'up')}
      ${kc('減持', `${(i.decreased?.holders || 0).toLocaleString()} 家`, `${big(i.decreased?.shares)} 股`, 'down')}
      ${kc('新建倉', `${(i.newPositions?.holders || 0).toLocaleString()} 家`, `${big(i.newPositions?.shares)} 股`, 'up')}
      ${kc('清倉', `${(i.soldOut?.holders || 0).toLocaleString()} 家`, `${big(i.soldOut?.shares)} 股`, 'down')}
      ${kc('淨增減股數', big((i.increased?.shares || 0) - (i.decreased?.shares || 0)), '增持 − 減持', cls((i.increased?.shares || 0) - (i.decreased?.shares || 0)))}
    </div>
    <div class="panel scroll"><table class="dt"><thead><tr><th>主要持有機構</th><th>申報日</th><th>持股</th><th>增減</th><th>增減 %</th><th>市值</th></tr></thead><tbody>
      ${i.holders.map(h => `<tr><td>${esc(h.name)}</td><td>${esc(h.date)}</td><td>${big(h.shares)}</td><td class="${cls(h.change)}">${h.change > 0 ? '+' : ''}${big(h.change)}</td><td class="${cls(h.changePct)}">${pct(h.changePct)}</td><td>$${big(h.value)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  if (si?.length) {
    const l = si[si.length - 1], p = si[si.length - 2];
    html += `<div class="sec"><h3>🩳 放空餘額（Short Interest） <small>每月兩次公布</small></h3><div class="cards">
      ${kc('放空股數', big(l.interest), p ? `較前期 ${pct((l.interest / p.interest - 1) * 100)}` : '', cls(p ? l.interest - p.interest : 0))}
      ${kc('回補天數', f2(l.daysToCover), l.daysToCover > 5 ? '偏高：有軋空潛力' : '')}
      ${kc('日均量', big(l.avgVolume))}
      ${kc('結算日', esc(l.date))}
    </div><div class="two"><div class="panel">${barLine(si, { bar: 'interest', line: 'daysToCover', labels: si.map(r => r.date.slice(0, 5)), lineFmt: v => f2(v, 1) })}<div class="note">藍柱：放空股數　黃線：回補天數</div></div>
    <div class="panel scroll"><table class="dt"><thead><tr><th>結算日</th><th>放空股數</th><th>日均量</th><th>回補天數</th></tr></thead><tbody>
      ${[...si].reverse().map(r => `<tr><td>${esc(r.date)}</td><td>${big(r.interest)}</td><td>${big(r.avgVolume)}</td><td>${f2(r.daysToCover)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }
  if (ins) {
    const t = ins.trades || {}, sh = ins.shares || {};
    const buys = t['Number of Open Market Buys'] || {}, sells = t['Number of Sells'] || {};
    html += `<div class="sec"><h3>👔 內部人交易</h3><div class="cards">
      ${kc('3 個月 買進 / 賣出', `${buys.m3 ?? '—'} / ${sells.m3 ?? '—'} 筆`, '', (buys.m3 || 0) > (sells.m3 || 0) ? 'up' : 'down')}
      ${kc('12 個月 買進 / 賣出', `${buys.m12 ?? '—'} / ${sells.m12 ?? '—'} 筆`, '', (buys.m12 || 0) > (sells.m12 || 0) ? 'up' : 'down')}
      ${Object.entries(sh).map(([k, v]) => kc(k.replace('Number of Shares ', '股數 ').replace('Bought', '買進').replace('Sold', '賣出').replace('Total Shares Traded', '總成交股數'), big(v.m3), `12 個月 ${big(v.m12)}`)).join('')}
    </div>
    <div class="panel scroll"><table class="dt"><thead><tr><th>內部人</th><th>職位</th><th>日期</th><th>交易類型</th><th>股數</th><th>價格</th><th>交易後持股</th></tr></thead><tbody>
      ${ins.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.relation)}</td><td>${esc(r.date)}</td><td class="${/buy/i.test(r.type) ? 'up' : /sell/i.test(r.type) ? 'down' : ''}">${esc(r.type)}</td><td>${big(r.shares)}</td><td>${r.price ? '$' + f2(r.price) : '—'}</td><td>${big(r.held)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  $('#pane-chips').innerHTML = html;
}

// ================= 消息面 =================
const newsItem = (n, i = 0) => `<li class="enter" style="--i:${Math.min(i, 12)}">${n.thumb ? `<img src="${esc(n.thumb)}" alt="" loading="lazy">` : ''}
  <div style="min-width:0;flex:1">${titleLink(n)}
  <div class="src">${(n.tickers || []).slice(0, 4).map(t => `<span class="tick">${esc(t)}</span>`).join('')}${esc(n.publisher)} · ${ago(n.time)}</div>
  ${newsActs(n)}</div></li>`;
async function loadNews() {
  const d = await api(`/api/news?symbol=${enc(SYM)}&name=${enc(S.name || '')}&pct=${S.quote?.changePct ?? ''}`);
  $('#newsList').innerHTML = d.map(newsItem).join('') || '<li class="muted">暫無相關新聞</li>';
  autoTr($('#newsList'));
}

// ================= 下單匣 =================
let side = 'buy', otype = 'limit', confirmArm = 0;
const isEtf = () => /^00/.test(SYM);
function sharesFromInput() {
  const q = Math.floor(Number($('#oQty').value) || 0);
  return TW && !$('#oOdd').checked ? q * 1000 : q;
}
function updateEstimate() {
  const px = otype === 'market' ? S.quote?.price : Number($('#oPrice').value);
  const sh = sharesFromInput();
  const amt = (px || 0) * sh;
  let fee = 0, tax = 0;
  if (TW && amt) { fee = Math.max(20, Math.floor(amt * 0.001425)); if (side === 'sell') tax = Math.floor(amt * (isEtf() ? 0.001 : 0.003)); }
  const total = side === 'buy' ? amt + fee : amt - fee - tax;
  const pos = S.account?.positions.find(p => p.symbol === SYM);
  const cash = S.account?.totals[TW ? 'TWD' : 'USD']?.cash;
  $('#oEst').innerHTML = `股數 <b>${sh.toLocaleString()}</b> 股　價格 <b>${px ? fmtP(px) : '—'}</b><br>
    成交金額 <b>${f2(amt, TW ? 0 : 2)}</b>${TW ? `　手續費 <b>${fee}</b>${side === 'sell' ? `　證交稅 <b>${tax}</b>` : ''}` : ''}<br>
    ${side === 'buy' ? '預估支出' : '預估收入'} <b class="${side === 'buy' ? 'up' : 'down'}">${curSym()}${f2(total, TW ? 0 : 2)}</b><br>
    可用現金 <b>${cash != null ? curSym() + f2(cash, TW ? 0 : 2) : '—'}</b>　庫存 <b>${pos ? pos.qty.toLocaleString() + ' 股' : '0'}</b>`;
  $('#oSubmit').textContent = confirmArm ? `確認${side === 'buy' ? '買進' : '賣出'}？再按一次送出` : (side === 'buy' ? '買進' : '賣出');
  $('#oSubmit').className = 'submit ' + side;
}
document.querySelectorAll('.ticket .sides button').forEach(b => b.onclick = () => {
  side = b.dataset.side; confirmArm = 0;
  document.querySelectorAll('.ticket .sides button').forEach(x => x.classList.toggle('on', x === b)); updateEstimate();
});
$('#otype').onclick = e => {
  const k = e.target.dataset.ot; if (!k) return;
  otype = k; confirmArm = 0;
  $('#otype').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.ot === k); b.style.background = b.dataset.ot === k ? 'var(--accent)' : 'none'; b.style.color = b.dataset.ot === k ? '#fff' : ''; });
  $('#oPrice').disabled = k === 'market'; updateEstimate();
};
$('#otype').querySelector('.on').style.cssText += ';background:var(--accent);color:#fff';
$('#oPx').onclick = () => { $('#oPrice').value = S.quote?.price ?? ''; delete $('#oPrice').dataset.touched; updateEstimate(); };
$('#oPrice').addEventListener('input', () => { $('#oPrice').dataset.touched = 1; confirmArm = 0; updateEstimate(); });
$('#oQty').addEventListener('input', () => { confirmArm = 0; updateEstimate(); });
$('#oOdd').addEventListener('change', () => { $('#qtyUnit').textContent = $('#oOdd').checked ? '股' : '張'; confirmArm = 0; updateEstimate(); });
if (!TW) { $('#lotRow').style.display = 'none'; $('#qtyUnit').textContent = '股'; }

$('#oSubmit').onclick = async () => {
  const sh = sharesFromInput();
  if (!(sh > 0)) return showMsg('請輸入數量', 'down');
  if (otype === 'limit' && !(Number($('#oPrice').value) > 0)) return showMsg('請輸入價格', 'down');
  // 防誤觸：兩段式確認（3 秒內再按一次才送出）
  if (!confirmArm) { confirmArm = setTimeout(() => { confirmArm = 0; updateEstimate(); }, 3000); updateEstimate(); return; }
  clearTimeout(confirmArm); confirmArm = 0;
  $('#oSubmit').disabled = true;
  try {
    const o = await post('/api/broker/order', { symbol: SYM, name: S.name, side, type: otype, qty: sh, price: otype === 'limit' ? Number($('#oPrice').value) : undefined });
    const txt = { filled: `✅ 已成交：${side === 'buy' ? '買進' : '賣出'} ${o.qty.toLocaleString()} 股 @ ${fmtP(o.fillPrice)}`, pending: `⏳ 委託中：${o.type === 'limit' ? '限價 ' + fmtP(o.price) : ''}，價格觸及時成交`, rejected: `❌ 委託失敗：${o.reason}` }[o.status];
    showMsg(txt, o.status === 'rejected' ? 'down' : o.status === 'filled' ? 'up' : '');
    await loadAccount();
  } catch (e) { showMsg('❌ ' + e.message, 'down'); }
  finally { $('#oSubmit').disabled = false; updateEstimate(); }
};
function showMsg(t, c = '') { $('#oMsg').className = 'msg ' + c; $('#oMsg').textContent = t; }
function toast(t) { showMsg(t, 'down'); }

// ================= 帳戶 =================
async function loadAccount() {
  const [acc, orders, info] = await Promise.all([api('/api/broker/account'), api('/api/broker/orders'), S.brokerInfo ? S.brokerInfo : api('/api/broker/info')]);
  S.account = acc; S.orders = orders; S.brokerInfo = info;
  $('#brokerBadge').textContent = info.live ? info.name : '模擬交易';
  const cur = TW ? 'TWD' : 'USD', t = acc.totals[cur], pos = acc.positions.find(p => p.symbol === SYM);
  $('#accBox').innerHTML = `<table class="lv">
    <tr><td>總權益（${cur}）</td><td class="num" style="text-align:right">${f2(t.equity, cur === 'TWD' ? 0 : 2)}</td><td class="num ${cls(t.returnPct)}" style="text-align:right">${pct(t.returnPct)}</td></tr>
    <tr><td>可用現金</td><td class="num" style="text-align:right">${f2(t.cash, cur === 'TWD' ? 0 : 2)}</td><td></td></tr>
    <tr><td>未實現 / 已實現</td><td class="num ${cls(t.unrealized)}" style="text-align:right">${f2(t.unrealized, 0)}</td><td class="num ${cls(t.realized)}" style="text-align:right">${f2(t.realized, 0)}</td></tr>
    ${pos ? `<tr class="now"><td>本檔持倉</td><td class="num" style="text-align:right">${pos.qty.toLocaleString()} 股 @ ${fmtP(pos.avgCost)}</td><td class="num ${cls(pos.unrealized)}" style="text-align:right">${pct(pos.unrealizedPct)}</td></tr>` : ''}
  </table>`;
  $('#accNote').textContent = info.live ? '' : '模擬資金';
  renderAccountPane(); updateEstimate();
}

function renderAccountPane() {
  const acc = S.account, orders = S.orders || [], info = S.brokerInfo || {};
  const st = { filled: ['已成交', 'up'], pending: ['委託中', ''], cancelled: ['已取消', 'muted'], rejected: ['失敗', 'down'] };
  $('#pane-account').innerHTML = `
    <div class="sec"><h3>💼 ${esc(acc.broker)} <small>${(info.notes || []).map(esc).join('　·　')}</small></h3><div class="cards">
      ${['TWD', 'USD'].map(c => { const t = acc.totals[c]; return kc(`總權益 ${c}`, f2(t.equity, c === 'TWD' ? 0 : 2), `現金 ${f2(t.cash, 0)}　報酬 ${pct(t.returnPct)}`, cls(t.returnPct)) + kc(`未實現 / 已實現 ${c}`, `${f2(t.unrealized, 0)} / ${f2(t.realized, 0)}`, '', cls(t.unrealized + t.realized)); }).join('')}
    </div></div>
    <div class="sec"><h3>📦 持倉</h3><div class="panel scroll"><table class="dt"><thead><tr><th>股票</th><th>股數</th><th>均價（含費）</th><th>現價</th><th>今日</th><th>市值</th><th>未實現損益</th><th>報酬率</th></tr></thead><tbody>
      ${acc.positions.length ? acc.positions.map(p => `<tr class="pos-row"><td><a href="${stockUrl(p.symbol)}"><b>${esc(isTW(p.symbol) ? short(p.symbol) : p.symbol)}</b> ${esc(p.name || '')}</a></td><td>${p.qty.toLocaleString()}</td><td>${fmtP(p.avgCost)}</td><td>${fmtP(p.price)}</td>
        <td class="${cls(p.changePct)}">${fmtPct(p.changePct)}</td><td>${f2(p.value, 0)} ${p.currency}</td><td class="${cls(p.unrealized)}">${f2(p.unrealized, 0)}</td><td class="${cls(p.unrealizedPct)}">${pct(p.unrealizedPct)}</td></tr>`).join('')
        : '<tr><td colspan="8" class="muted">尚無持倉</td></tr>'}
    </tbody></table></div></div>
    <div class="sec"><h3>🧾 委託紀錄 <small>限價單在價格觸及時成交</small></h3><div class="panel scroll"><table class="dt"><thead><tr><th>時間</th><th>股票</th><th>買賣</th><th>類型</th><th>股數</th><th>委託價</th><th>成交價</th><th>費用</th><th>狀態</th><th></th></tr></thead><tbody>
      ${orders.length ? orders.map(o => `<tr><td>${new Date(o.createdAt).toLocaleString('zh-TW', { hour12: false })}</td><td>${esc(isTW(o.symbol) ? short(o.symbol) : o.symbol)} ${esc(o.name || '')}</td>
        <td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '買進' : '賣出'}</td><td>${o.type === 'limit' ? '限價' : '市價'}</td><td>${o.qty.toLocaleString()}</td><td>${o.price ? fmtP(o.price) : '—'}</td>
        <td>${o.fillPrice ? fmtP(o.fillPrice) : '—'}</td><td>${o.status === 'filled' ? (o.fee || 0) + (o.tax || 0) : '—'}</td><td class="${st[o.status]?.[1] || ''}" title="${esc(o.reason || '')}">${st[o.status]?.[0] || o.status}${o.reason ? '：' + esc(o.reason) : ''}</td>
        <td>${o.status === 'pending' ? `<button data-cancel="${o.id}" style="font-size:11px;padding:1px 8px">取消</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="10" class="muted">尚無委託</td></tr>'}
    </tbody></table></div></div>
    <p class="note">未來串接真實券商時，只需在伺服器端新增 broker adapter（例如永豐 Shioaji、富邦 Neo、Interactive Brokers），此頁面不需修改。<button id="resetAcc" style="font-size:11px;padding:1px 8px;margin-left:8px">重設模擬帳戶</button></p>`;
}
$('#pane-account').addEventListener('click', async e => {
  const id = e.target.dataset?.cancel;
  if (id) { try { await post('/api/broker/cancel', { id }); await loadAccount(); } catch (err) { alert(err.message); } }
  if (e.target.id === 'resetAcc' && confirm('確定要重設模擬帳戶？所有持倉與紀錄都會清除。')) { await post('/api/broker/reset', {}); await loadAccount(); }
});

// ================= 分頁 =================
function openTab(k) {
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + k));
  if (k === 'chips' && S.chips && TW && LC) setTimeout(drawInstChart, 30); // 顯示後才有尺寸
}
$('#tabbar').onclick = e => { const k = e.target.dataset.tab; if (k) { openTab(k); history.replaceState(null, '', '#' + k); } };

// ================= 啟動 =================
const safe = (fn, label) => fn().catch(e => { console.warn(label, e); });
(async () => {
  $('#qSym').textContent = TW ? short(SYM) : SYM;
  renderStar();
  const [l, live] = marketState(); $('#state').textContent = l; $('#state').classList.toggle('live', live);
  const chartsOk = initCharts();
  await safe(loadQuote, 'quote');
  await Promise.all([
    chartsOk ? loadTech(true).catch(e => { $('#mainChart').innerHTML = `<div class="empty">技術資料載入失敗：${esc(e.message)}</div>`; }) : null,
    safe(loadFund, 'fund').then(() => {}),
    safe(loadAccount, 'account'),
  ]);
  safe(loadChips, 'chips');
  safe(loadNews, 'news');
  const h = location.hash.slice(1);
  if (['fund', 'chips', 'news', 'ind', 'account'].includes(h)) { openTab(h); $('#tabbar').scrollIntoView({ behavior: 'smooth' }); }
})();
setInterval(() => { if (!document.hidden) safe(loadQuote, 'quote'); const [l, live] = marketState(); $('#state').textContent = l; $('#state').classList.toggle('live', live); }, 10_000);
setInterval(() => { if (!document.hidden && tf === 'D') safe(() => loadTech(false), 'tech'); }, 60_000);
setInterval(() => { if (!document.hidden) safe(loadAccount, 'account'); }, 30_000);
