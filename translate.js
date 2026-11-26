// 翻譯機 + 新聞摘要
// 翻譯：Google 翻譯免費端點（免金鑰）
// 摘要：有設定 ANTHROPIC_API_KEY 時用 Claude 寫摘要；否則用抽取式摘要（挑出最重要的句子）
// 規則：摘要沿用原文語言（英文新聞 → 英文摘要；中文新聞 → 中文摘要），要中文再另外按翻譯
import https from 'node:https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

// ---------- 小工具 ----------
const memo = new Map();
function remember(key, fn, max = 2000) {
  if (memo.has(key)) return memo.get(key);
  const p = fn();
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  if (memo.size > max) memo.delete(memo.keys().next().value);
  return p;
}

// Yahoo 文章頁的回應標頭很大，內建 fetch 會 HeadersOverflow，所以用 https 模組並放寬上限
function getPage(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { maxHeaderSize: 256 * 1024, timeout: 12000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        return resolve(getPage(new URL(res.headers.location, url).href, hops + 1));
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; if (body.length > 3e6) req.destroy(new Error('too large')); });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const stripTags = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const cjkRatio = s => (s.match(/[㐀-鿿]/g) || []).length / Math.max(1, s.replace(/\s/g, '').length);
export const detectLang = s => cjkRatio(s) > 0.2 ? 'zh' : 'en';

// ---------- 翻譯 ----------
async function gtx(text, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`翻譯服務 ${r.status}`);
  const j = await r.json();
  return { text: (j[0] || []).map(x => x[0]).join(''), from: j[2] };
}

// 長文分段翻譯（每段 ≤ 1500 字，以換行或句號切）
function chunks(text, size = 1500) {
  const out = [];
  let buf = '';
  for (const part of text.split(/(?<=[\n。！？.!?])/)) {
    if (buf.length + part.length > size && buf) { out.push(buf); buf = ''; }
    buf += part;
  }
  if (buf) out.push(buf);
  return out;
}

// to: 'zh-TW' | 'en' | 'auto'（auto = 中文翻英文，其他翻繁中）
export function translate(text, to = 'auto') {
  text = String(text || '').slice(0, 20000);
  if (!text.trim()) return Promise.resolve({ text: '', from: '', to });
  const target = to === 'auto' ? (detectLang(text) === 'zh' ? 'en' : 'zh-TW') : to;
  return remember(`tr:${target}:${text}`, async () => {
    const parts = await Promise.all(chunks(text).map(c => gtx(c, target)));
    return { text: parts.map(p => p.text).join(''), from: parts[0]?.from || '', to: target };
  });
}

// 批次翻譯多個標題：用換行串成一次請求，再拆回來
export async function translateMany(texts, to = 'zh-TW') {
  const list = texts.map(t => String(t || '').replace(/\n/g, ' ').slice(0, 500));
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i += 25) {
    const batch = list.slice(i, i + 25);
    const r = await translate(batch.join('\n'), to);
    const lines = r.text.split('\n');
    if (lines.length === batch.length) lines.forEach((l, k) => { out[i + k] = l.trim(); });
    else (await Promise.all(batch.map(t => translate(t, to)))).forEach((x, k) => { out[i + k] = x.text; });
  }
  return out;
}

// ---------- 抓文章全文 ----------
// 鉅亨網列表 API 本身就帶全文，存起來給摘要用
export const articleStore = new Map();
export function storeArticle(link, html) {
  if (!link || !html) return;
  articleStore.set(link, stripTags(decode(html)));
  if (articleStore.size > 500) articleStore.delete(articleStore.keys().next().value);
}

export function fetchArticle(link) {
  if (articleStore.has(link)) return Promise.resolve(articleStore.get(link));
  return remember(`art:${link}`, async () => {
    const u = new URL(link);
    if (u.hostname === 'news.google.com') throw new Error('Google 新聞連結無法取得全文，請開啟原文閱讀');
    const html = await getPage(link);
    const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, '');
    // 只留像「內文」的段落：夠長、以句末標點結尾（排除相關新聞標題、按鈕文字）
    const paras = [...body.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
      .map(m => stripTags(m[1]))
      .filter(s => s.length > 40 && /[.!?。！？」"”)]$/.test(s) && !/^(Warning!|Read more|Sign up|Subscribe|Is \w+ fairly valued)/i.test(s));
    let text = [...new Set(paras)].join('\n');
    if (text.length < 200) {
      const desc = (html.match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"/i) || [])[1];
      if (desc) text = decode(desc) + (text ? '\n' + text : '');
    }
    if (!text.trim()) throw new Error('抓不到文章內文');
    return text.slice(0, 30000);
  }, 300);
}

// ---------- 摘要 ----------
const STOP = new Set(('a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its ' +
  'he she they we you i his her their our your not no do does did has have had will would can could should may might also than then ' +
  'so such there here what which who whom when where why how all any each more most other some into over after before about up down out ' +
  'said says say per just only very new one two first last year years week day time percent inc corp co ltd').split(' '));

function tokens(s, lang) {
  if (lang === 'zh') {
    const cjk = s.replace(/[^㐀-鿿]/g, '');
    const out = [];
    for (let i = 0; i < cjk.length - 1; i++) out.push(cjk.slice(i, i + 2));
    return out;
  }
  return (s.toLowerCase().match(/[a-z][a-z'-]+|\d+(?:\.\d+)?%?/g) || []).filter(w => !STOP.has(w) && w.length > 2);
}

// 抽取式摘要：詞頻 + 標題重疊 + 位置加權，挑出 n 句並依原順序排列
export function extractive(text, title = '', n = 3) {
  const lang = detectLang(text);
  const sentences = text.split(lang === 'zh' ? /(?<=[。！？])|\n/ : /(?<=[.!?])\s+(?=[A-Z"“(])|\n/)
    .map(s => s.trim()).filter(s => s.length > (lang === 'zh' ? 12 : 40) && s.length < 600);
  if (sentences.length <= n) return { lang, points: sentences };
  const freq = new Map();
  for (const s of sentences) for (const t of tokens(s, lang)) freq.set(t, (freq.get(t) || 0) + 1);
  const titleT = new Set(tokens(title, lang));
  const scored = sentences.map((s, i) => {
    const ts = tokens(s, lang);
    if (!ts.length) return { s, i, score: 0 };
    const base = ts.reduce((a, t) => a + (freq.get(t) || 0), 0) / Math.pow(ts.length, 0.6);
    const overlap = ts.filter(t => titleT.has(t)).length;
    const position = i === 0 ? 1.6 : i < 3 ? 1.25 : 1;
    const numbers = /\d/.test(s) ? 1.1 : 1; // 財經新聞裡含數字的句子通常是重點
    return { s, i, score: (base + overlap * 2) * position * numbers };
  });
  // 新聞導言通常就是重點，固定保留第一句，其餘挑分數最高的
  const [lead, ...rest] = scored;
  const top = [lead, ...rest.sort((a, b) => b.score - a.score).slice(0, n - 1)].sort((a, b) => a.i - b.i);
  return { lang, points: top.map(x => x.s) };
}

// Claude 摘要（只有設定了 API 金鑰才會啟用）
let clientPromise = null;
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
function claude() {
  clientPromise ??= import('@anthropic-ai/sdk').then(m => new m.default());
  return clientPromise;
}

async function aiSummary(text, title) {
  const client = await claude();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low' },
    // 若主模型因安全分類拒答，伺服器端自動改由備援模型處理
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: 'You summarize financial news for a stock-tracking dashboard. Write the summary in the SAME language as the article: ' +
      'an English article gets an English summary; a Chinese article gets a Traditional Chinese summary. ' +
      'Give 3 to 5 short bullet points covering what happened, the key numbers, and why it matters for the stock or market. ' +
      'Output only the bullet lines, each starting with "- ".',
    messages: [{ role: 'user', content: `Title: ${title}\n\nArticle:\n${text}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI 拒絕摘要此內容');
  const out = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const points = out.split('\n').map(l => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
  if (!points.length) throw new Error('AI 沒有回傳摘要');
  return points;
}

// 摘要入口：link（抓全文）或 text（使用者貼上的文字）
export function summarize({ link, text, title = '' }) {
  return remember(`sum:${link || text}`, async () => {
    const body = text?.trim() ? text.slice(0, 30000) : await fetchArticle(link);
    const lang = detectLang(title + ' ' + body.slice(0, 2000));
    if (aiEnabled()) {
      try { return { lang, method: 'ai', points: await aiSummary(body, title) }; }
      catch (e) { console.error('AI 摘要失敗，改用抽取式：', e.message); }
    }
    const r = extractive(body, title, 3);
    return { lang: r.lang, method: 'extractive', points: r.points };
  }, 300);
}
