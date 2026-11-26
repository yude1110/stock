// 共用：格式化、數字動畫、走勢小圖、漲跌顏色、翻譯 / 摘要、翻譯機、代號搜尋
// 儀表板（index.html）與個股分析頁（stock.html）共用

// 翻譯機側欄（動態插入，讓每一頁都有）
document.body.insertAdjacentHTML('beforeend', `<button class="fab" id="fab" title="翻譯機 / 摘要">🌐</button>
<aside class="drawer" id="drawer" aria-label="翻譯機">
  <div class="row"><h2 style="margin:0">🌐 翻譯機</h2><span class="spacer"></span><button id="drawerClose">✕</button></div>
  <div class="muted" style="font-size:12px">貼上文字翻譯；貼上新聞網址或整篇文章可做摘要（摘要沿用原文語言，英文新聞仍以英文呈現）。也可以直接在頁面上選取文字翻譯。Ctrl+Enter 快速翻譯。</div>
  <textarea id="trIn" placeholder="輸入或貼上文字 / 新聞網址…"></textarea>
  <div class="row">
    <select id="trTo">
      <option value="auto">自動（中↔英）</option><option value="zh-TW">→ 繁體中文</option><option value="en">→ English</option><option value="ja">→ 日本語</option>
    </select>
    <button class="primary" id="trGo">翻譯</button>
    <button id="sumGo">摘要</button>
    <span class="spacer"></span>
    <button id="trXlate" hidden title="英文摘要附上中文翻譯">翻譯結果</button>
    <button id="trCopy" title="複製結果">複製</button>
  </div>
  <div class="loadingbar" id="trLoad"></div>
  <div class="out" id="trOut"></div>
  <div class="muted" id="trMeta" style="font-size:12px"></div>
</aside>`);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTW = s => /\.(TW|TWO)$|^\^TW|^WTX/.test(s);
const short = s => s.replace(/\.(TW|TWO)$/, '');

// ---------- 格式化 ----------
const fmtP = v => v == null || isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 });
const fmtPct = v => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const fmtChg = v => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + fmtP(v);
const FMT = { p: fmtP, pct: fmtPct, chg: fmtChg };
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const big = v => { if (!v) return '—'; for (const [n, s] of [[1e12, '兆'], [1e8, '億'], [1e4, '萬']]) if (Math.abs(v) >= n) return (v / n).toFixed(2) + s; return Math.round(v).toLocaleString(); };
const vol = (v, sym) => !v ? '—' : isTW(sym) ? big(v / 1000) + ' 張' : big(v);
const ago = t => { const s = Date.now() / 1000 - t; if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' 分鐘前'; if (s < 86400) return Math.round(s / 3600) + ' 小時前'; return Math.round(s / 86400) + ' 天前'; };
const api = async p => { const r = await fetch(p); if (!r.ok) throw new Error(r.status); return r.json(); };

// ---------- 數字滾動動畫 ----------
const numCache = {};
const num = (key, v, f) => `<span class="num" data-k="${esc(key)}" data-v="${v ?? ''}" data-f="${f}">${FMT[f](v)}</span>`;
function animateNums(root) {
  root.querySelectorAll('[data-k]').forEach(el => {
    const key = el.dataset.k, to = parseFloat(el.dataset.v), from = numCache[key];
    numCache[key] = to;
    if (reduceMotion || from == null || isNaN(to) || from === to) return;
    const f = FMT[el.dataset.f], t0 = performance.now(), D = 700;
    const step = now => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      el.textContent = f(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function spark(data, up, w = 120, h = 34) {
  if (!data || data.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const min = Math.min(...data), max = Math.max(...data), r = max - min;
  // 整天鎖漲跌停時是一條平線，畫在中間
  const yy = v => r ? h - 2 - (v - min) / r * (h - 4) : h / 2;
  const pts = data.map((v, i) => `${(i / (data.length - 1) * w).toFixed(1)},${yy(v).toFixed(1)}`).join(' ');
  const c = `var(${up ? '--up' : '--down'})`, id = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    <polygon fill="url(#${id})" points="0,${h} ${pts} ${w},${h}"/><polyline fill="none" stroke="${c}" stroke-width="1.6" points="${pts}"/></svg>`;
}

// ---------- 漲跌顏色 ----------
let usColors = store.get('usColors', false);
function applyColors() { document.body.classList.toggle('us', usColors); if ($('#colorBtn')) $('#colorBtn').textContent = usColors ? '綠漲紅跌' : '紅漲綠跌'; }
if ($('#colorBtn')) $('#colorBtn').onclick = () => { usColors = !usColors; store.set('usColors', usColors); applyColors(); };
applyColors();


// ================= 翻譯 / 摘要 =================
const post = async (p, b) => {
  const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};
const isEn = s => (String(s).match(/[㐀-鿿]/g) || []).length / Math.max(1, String(s).replace(/\s/g, '').length) < 0.2;
const canSum = link => !/news\.google\.com/.test(link || ''); // Google 新聞是轉址連結，抓不到全文
const titleLink = n => `<a class="ttl" href="${esc(n.link)}" target="_blank" rel="noopener" data-en="${isEn(n.title) ? 1 : ''}" data-t="${esc(n.title)}">${esc(n.title)}</a>`;
const newsActs = n => `<div class="acts"><button data-act="tr" data-text="${esc(n.title)}">${isEn(n.title) ? '譯中文' : 'EN'}</button>${canSum(n.link)
  ? `<button data-act="sum" data-link="${esc(n.link)}" data-title="${esc(n.title)}">摘要</button>` : ''}</div><div class="xbox"></div>`;

// 英文標題自動附中譯（英文原文保留在上面）
let autoOn = store.get('autoTr', true);
const trCache = {};
function applyAutoBtn() { $('#trBtn')?.classList.toggle('on', autoOn); }
if ($('#trBtn')) $('#trBtn').onclick = () => {
  autoOn = !autoOn; store.set('autoTr', autoOn); applyAutoBtn();
  if (autoOn) document.querySelectorAll('#news, #focus, #dNews').forEach(autoTr);
  else document.querySelectorAll('.zh.auto').forEach(el => el.remove());
};
applyAutoBtn();
async function autoTr(root) {
  if (!autoOn || !root) return;
  const hasZh = el => el.nextElementSibling?.classList.contains('zh');
  const els = [...root.querySelectorAll('.ttl[data-en="1"]')].filter(el => !hasZh(el));
  const need = [...new Set(els.map(el => el.dataset.t).filter(t => !(t in trCache)))];
  if (need.length) {
    try { const r = await post('/api/translate', { texts: need, to: 'zh-TW' }); need.forEach((t, i) => { trCache[t] = r.texts[i]; }); }
    catch (e) { console.warn('翻譯失敗', e); return; }
  }
  for (const el of els) {
    if (!autoOn || hasZh(el) || !trCache[el.dataset.t]) continue;
    el.insertAdjacentHTML('afterend', `<div class="zh auto">${esc(trCache[el.dataset.t])}</div>`);
  }
}

const METHOD = { ai: 'AI 摘要（Claude）', extractive: '重點句擷取' };
async function doAct(btn) {
  const acts = btn.closest('.acts'), holder = btn.closest('li, .card');
  if (btn.dataset.act === 'tr') {
    // 標題翻譯：英文 → 中文、中文 → 英文；再按一次收起
    const ttl = holder.querySelector('.ttl');
    const existing = ttl?.nextElementSibling?.classList.contains('zh') ? ttl.nextElementSibling : null;
    if (existing) { existing.remove(); btn.classList.remove('on'); return; }
    btn.classList.add('on');
    const text = btn.dataset.text, to = isEn(text) ? 'zh-TW' : 'en';
    try {
      const r = to === 'zh-TW' && trCache[text] ? { text: trCache[text] } : await post('/api/translate', { text, to });
      ttl.insertAdjacentHTML('afterend', `<div class="zh">${esc(r.text)}</div>`);
    } catch (e) { btn.classList.remove('on'); alert('翻譯失敗：' + e.message); }
    return;
  }
  if (btn.dataset.act === 'sum') {
    const box = acts.nextElementSibling;
    if (btn.classList.contains('on')) { box.innerHTML = ''; btn.classList.remove('on'); return; }
    btn.classList.add('on');
    box.innerHTML = '<span class="muted dots">正在讀取文章並摘要</span>';
    try {
      const r = await post('/api/summarize', { link: btn.dataset.link, title: btn.dataset.title });
      // 摘要沿用原文語言；英文摘要可再按「翻成中文」
      box.innerHTML = `<div class="hd">📝 <b>${METHOD[r.method] || '摘要'}</b><span>· ${r.lang === 'en' ? 'English' : '中文'}</span>
        ${r.lang === 'en' ? '<span class="spacer"></span><button data-act="trsum" style="font-size:11px;padding:1px 8px">翻成中文</button>' : ''}</div>
        <ul>${r.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
      box.dataset.points = JSON.stringify(r.points);
    } catch (e) { box.innerHTML = `<span class="err">⚠ ${esc(e.message)}</span>`; }
    return;
  }
  if (btn.dataset.act === 'trsum') {
    const sbox = btn.closest('.xbox');
    const old = sbox.querySelector('.zhsum');
    if (old) { old.remove(); btn.textContent = '翻成中文'; return; }
    btn.textContent = '翻譯中…';
    try {
      const r = await post('/api/translate', { texts: JSON.parse(sbox.dataset.points || '[]'), to: 'zh-TW' });
      sbox.insertAdjacentHTML('beforeend', `<div class="zhsum">譯｜<ul>${r.texts.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`);
      btn.textContent = '收起中譯';
    } catch (e) { btn.textContent = '翻成中文'; alert('翻譯失敗：' + e.message); }
  }
}

// ---------- 翻譯機側欄 ----------
const drawer = $('#drawer');
$('#fab').onclick = () => { drawer.classList.toggle('open'); if (drawer.classList.contains('open')) $('#trIn').focus(); };
$('#drawerClose').onclick = () => drawer.classList.remove('open');
addEventListener('keydown', e => { if (e.key === 'Escape') drawer.classList.remove('open'); });
async function runDrawer(kind) {
  const text = $('#trIn').value.trim(); if (!text) return;
  $('#trLoad').classList.add('on'); $('#trOut').textContent = ''; $('#trMeta').textContent = '';
  try {
    if (kind === 'tr') {
      const r = await post('/api/translate', { text, to: $('#trTo').value });
      $('#trOut').textContent = r.text;
      $('#trMeta').textContent = `Google 翻譯 · → ${{ 'zh-TW': '繁體中文', en: 'English', ja: '日本語' }[r.to] || r.to}`;
    } else {
      const isUrl = /^https?:\/\/\S+$/.test(text);
      const r = await post('/api/summarize', isUrl ? { link: text } : { text });
      $('#trOut').textContent = r.points.map(p => '• ' + p).join('\n');
      $('#trMeta').textContent = `${METHOD[r.method]} · 摘要語言：${r.lang === 'en' ? 'English（沿用原文）· 需要中文可按「翻譯結果」' : '中文'}`;
      $('#trXlate').hidden = r.lang !== 'en';
    }
  } catch (e) { $('#trOut').textContent = '⚠ ' + e.message; }
  finally { $('#trLoad').classList.remove('on'); }
}
$('#trGo').onclick = () => runDrawer('tr');
$('#sumGo').onclick = () => runDrawer('sum');
$('#trIn').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runDrawer('tr'); });
$('#trCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#trOut').textContent); $('#trCopy').textContent = '已複製 ✓'; setTimeout(() => { $('#trCopy').textContent = '複製'; }, 1200); } catch {}
};
// 英文摘要 → 翻成中文（附在下方，英文保留）
$('#trXlate').onclick = async () => {
  const src = $('#trOut').textContent.split('\n\n譯｜')[0];
  $('#trLoad').classList.add('on');
  try {
    const r = await post('/api/translate', { text: src, to: 'zh-TW' });
    $('#trOut').textContent = src + '\n\n譯｜\n' + r.text;
    $('#trXlate').hidden = true;
  } catch (e) { alert('翻譯失敗：' + e.message); }
  finally { $('#trLoad').classList.remove('on'); }
};

// ---------- 選取文字 → 翻譯泡泡 ----------
let bub = null, pop = null;
const clearSel = () => { bub?.remove(); pop?.remove(); bub = pop = null; };
document.addEventListener('mouseup', e => {
  if (e.target.closest('.selbub, .selpop, textarea, input, button')) return;
  setTimeout(() => {
    const sel = getSelection(), text = sel.toString().trim();
    bub?.remove(); bub = null;
    if (text.length < 2 || text.length > 3000 || !sel.rangeCount) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const x = r.left + scrollX + r.width / 2 - 30, y = r.bottom + scrollY + 6;
    bub = document.createElement('button');
    bub.className = 'selbub'; bub.textContent = '🌐 翻譯';
    bub.style.left = x + 'px'; bub.style.top = y + 'px';
    bub.onmousedown = ev => ev.preventDefault();
    bub.onclick = async ev => {
      ev.stopPropagation();
      bub.textContent = '翻譯中…';
      try {
        const t = await post('/api/translate', { text, to: 'auto' });
        clearSel();
        pop = document.createElement('div'); pop.className = 'selpop';
        pop.innerHTML = `<div class="muted" style="font-size:11px;margin-bottom:3px">${t.to === 'en' ? '中 → 英' : '→ 繁體中文'}</div>${esc(t.text)}`;
        pop.style.left = Math.max(8, Math.min(x, scrollX + innerWidth - 400)) + 'px'; pop.style.top = y + 'px';
        document.body.appendChild(pop);
      } catch { if (bub) bub.textContent = '翻譯失敗'; }
    };
    document.body.appendChild(bub);
  }, 10);
});
document.addEventListener('mousedown', e => { if (!e.target.closest('.selbub, .selpop')) clearSel(); });


// ---------- 翻譯 / 摘要按鈕（全站，capture 階段先處理，避免觸發其他點擊行為） ----------
document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) { e.preventDefault(); e.stopPropagation(); doAct(act); }
}, true);

// ---------- 代號搜尋（代號或中文名稱）→ 個股分析頁 ----------
const stockUrl = s => '/stock.html?symbol=' + encodeURIComponent(s);
function mountSearch(input) {
  const wrap = input.parentElement;
  let dd = null, items = [], sel = 0, timer = null, seq = 0;
  const close = () => { dd?.remove(); dd = null; };
  const render = () => {
    close();
    if (!items.length) return;
    dd = document.createElement('div'); dd.className = 'dd';
    dd.innerHTML = items.map((x, i) => `<a href="${stockUrl(x.symbol)}" class="${i === sel ? 'on' : ''}"><b>${esc(isTW(x.symbol) ? short(x.symbol) : x.symbol)}</b>${esc(x.name)}<span>${esc([x.exchange, x.industry].filter(Boolean).join(' · '))}</span></a>`).join('');
    wrap.appendChild(dd);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { items = []; close(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      const r = await api('/api/search?q=' + encodeURIComponent(q)).catch(() => []);
      if (my !== seq) return;
      items = r; sel = 0; render();
    }, 180);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); } }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim().toUpperCase();
      if (items[sel]) location.href = stockUrl(items[sel].symbol);
      else if (q) location.href = stockUrl(/^\d{4,6}[A-Z]?$/.test(q) ? q + '.TW' : q);
    } else if (e.key === 'Escape') close();
  });
  document.addEventListener('mousedown', e => { if (!wrap.contains(e.target)) close(); });
}
document.querySelectorAll('.search input').forEach(mountSearch);
