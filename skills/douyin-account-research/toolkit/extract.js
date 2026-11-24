// extract.js — pull the video list (id / title / play count / duration) off a Douyin page
// through CDP, scrolling until the list stops growing.
//
//   node extract.js <url> [maxScrolls] [outFile]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = process.argv[2];
const maxScrolls = Number(process.argv[3] || 12);
const outFile = process.argv[4] || join(HERE, 'videos.json');
if (!url) { console.error('usage: node extract.js <url> [maxScrolls] [outFile]'); process.exit(1); }

let n = 0;
class S {
  constructor(ws) { this.ws = ws; this.pending = new Map(); }
  static async open(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    const s = new S(ws);
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.id != null && s.pending.has(m.id)) {
        const p = s.pending.get(m.id); s.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    return s;
  }
  send(m, p = {}) {
    const id = ++n;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('timeout ' + m)); }, 30000);
    });
  }
}

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page target — run start.ps1 first'); process.exit(1); }
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await s.send('Page.enable');
await s.send('Page.navigate', { url });
await sleep(5000);

const PAGE_EXPR = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll('div[data-aweme-id]')];
  const seen = new Map();
  for (const c of cards) {
    const id = c.getAttribute('data-aweme-id');
    if (!id || seen.has(id)) continue;
    const href = c.querySelector('[href*="/video/"]')?.getAttribute('href') || '';
    const img = c.querySelector('img');
    const title = txt(img?.getAttribute('alt')) || txt(c.innerText).slice(0, 120);
    const t = txt(c.innerText);
    const play = (t.match(/(\\d+(?:\\.\\d+)?)\\s*万/) || [])[0] || (t.match(/\\b(\\d{4,})\\b/) || [])[0] || null;
    const dur = (t.match(/\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b/) || [])[0] || null;
    const stats = c.querySelectorAll('[data-e2e*="video-"]').length;
    const digg = (c.innerText.match(/(\\d+(?:\\.\\d+)?万?)\\s*(?:点赞|赞)/) || [])[1] || null;
    seen.set(id, { id, href: href.startsWith('//') ? 'https:' + href : href, title, play, dur, digg, stats });
  }
  const links = [...document.querySelectorAll('a[href*="/video/"]')];
  for (const a of links) {
    const id = (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    const t = txt(a.innerText);
    seen.set(id, { id, href: a.getAttribute('href'), title: t.slice(0, 120), play: null, dur: null, digg: null, stats: 0 });
  }
  const scrollers = [...document.querySelectorAll('div,main,section')]
    .filter((el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300)
    .sort((a, b) => b.clientHeight - a.clientHeight);
  const box = scrollers[0];
  if (box) box.scrollTop = box.scrollTop + box.clientHeight * 0.85;
  else window.scrollTo(0, document.body.scrollHeight);
  return {
    url: location.href,
    title: document.title,
    count: seen.size,
    items: [...seen.values()],
    scrolled: box ? Math.round(box.scrollTop) : window.scrollY,
  };
})()`;

let last = -1, stable = 0;
const all = new Map();
for (let i = 1; i <= maxScrolls; i++) {
  const r = await ev(PAGE_EXPR);
  (r.items || []).forEach((it) => { if (!all.has(it.id)) all.set(it.id, it); });
  console.log(`[${i}/${maxScrolls}] url=${r.url.slice(0, 50)} cards=${r.count} total=${all.size} scrolled=${r.scrolled}`);
  if (all.size === last) { stable++; if (stable >= 2) { console.log('list stopped growing, done.'); break; } }
  else stable = 0;
  last = all.size;
  await sleep(1800);
}

const items = [...all.values()];
writeFileSync(outFile, JSON.stringify({ page: url, count: items.length, items }, null, 2), 'utf8');
console.log(`\ncollected ${items.length} items -> ${outFile}\n`);
items.forEach((v, i) => console.log(`  [${String(i + 1).padStart(2)}] ${v.dur || '--:--'}  ${v.play || '--'}  ${v.title.slice(0, 70)}`));
s.ws.close();
process.exit(0);
