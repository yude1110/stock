// 共用：抓資料 + 快取
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

// 同一個 key 的併發請求共用同一個 Promise；失敗不快取
const cache = new Map();
export function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;
  const p = fn();
  cache.set(key, { t: Date.now(), p });
  p.catch(() => cache.delete(key));
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return p;
}

export async function fetchText(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
  return r.text();
}
export const getJSON = async (url, headers) => JSON.parse(await fetchText(url, headers));

export const num = v => { const n = parseFloat(String(v ?? '').replace(/[$+%,]/g, '')); return Number.isFinite(n) ? n : null; };
export const isTW = s => /\.(TW|TWO)$|^\^TW|^WTX/.test(s);
export const ymd = d => d.toISOString().slice(0, 10);
export const daysAgo = n => ymd(new Date(Date.now() - n * 86400000));
