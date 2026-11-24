// profile.js — scrape a Douyin profile page: profile stats + the account's OWN video list.
//
//   node profile.js <secUidOrFullUrl> [maxScrolls]
//
// Own videos live under [data-e2e="user-post-list"]; "推荐" cards are excluded.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = process.argv[2];
const maxScrolls = Number(process.argv[3] || 8);
if (!arg) { console.error('usage: node profile.js <secUid|url> [maxScrolls]'); process.exit(1); }
const url = arg.startsWith('http') ? arg : `https://www.douyin.com/user/${arg}`;

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
await sleep(6000);

// How many distinct data-e2e values exist, so we can find the post list container.
const E2E = `(() => [...new Set([...document.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e')))])()`;
console.log('data-e2e values:', JSON.stringify(await ev(E2E)));

const STATS = `(() => {
  const t = (document.body.innerText || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ');
  const grab = (re) => (t.match(re) || [])[1] || null;
  return {
    url: location.href,
    title: document.title,
    statsLine: (t.match(/(抖音号[^。]{0,80})/) || [])[0] || null,
    likes: grab(/([\\d.]+万?)\\s*获赞/),
    fans: grab(/([\\d.]+万?)\\s*粉丝/),
    following: grab(/([\\d.]+万?)\\s*关注/),
    // profile pages render each card's play count as a bare number before the title
    sampleText: t.slice(0, 600),
  };
})()`;
console.log('stats:', JSON.stringify(await ev(STATS), null, 2));

const CARDS = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const scope = document.querySelector('[data-e2e="user-post-list"]') || document;
  const out = { scopeFound: !!document.querySelector('[data-e2e="user-post-list"]'), items: [], scrolled: 0, raw: null };
  const cards = [...scope.querySelectorAll('div[data-aweme-id], li[data-aweme-id]')];
  const seen = new Set();
  for (const c of cards) {
    const id = c.getAttribute('data-aweme-id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const img = c.querySelector('img');
    const t = txt(c.innerText);
    out.items.push({
      id,
      title: txt(img && img.getAttribute('alt')) || t.slice(0, 150),
      play: (t.match(/([\\d.]+万?)/) || [])[1] || null,
      dur: (t.match(/\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b/) || [])[1] || null,
      raw: t.slice(0, 120),
    });
  }
  if (!cards.length) out.raw = txt(scope.innerText).slice(0, 400);
  const scrollers = [...document.querySelectorAll('div,main,section')]
    .filter((el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300)
    .sort((a, b) => b.clientHeight - a.clientHeight);
  const box = scrollers[0];
  if (box) box.scrollTop = box.scrollTop + box.clientHeight * 0.85;
  else window.scrollTo(0, document.body.scrollHeight);
  out.scrolled = box ? Math.round(box.scrollTop) : window.scrollY;
  return out;
})()`;

const all = new Map();
let last = -1, stable = 0;
for (let i = 1; i <= maxScrolls; i++) {
  const r = await ev(CARDS);
  (r.items || []).forEach((it) => { if (!all.has(it.id)) all.set(it.id, it); });
  console.log(`[${i}/${maxScrolls}] scope=${r.scopeFound} cards=${r.items.length} total=${all.size} scrolled=${r.scrolled}`);
  if (r.raw && i === 1) console.log('  raw scope text:', r.raw);
  if (all.size === last) { stable++; if (stable >= 2) { console.log('stopped growing.'); break; } }
  else stable = 0;
  last = all.size;
  await sleep(1800);
}

const items = [...all.values()];
const outFile = join(HERE, 'profile.json');
writeFileSync(outFile, JSON.stringify({ url, count: items.length, items }, null, 2), 'utf8');
console.log(`\ncollected ${items.length} own videos -> ${outFile}\n`);
items.forEach((v, i) => console.log(`  [${String(i + 1).padStart(2)}] play=${String(v.play || '-').padStart(7)}  ${v.title.slice(0, 78)}`));
s.ws.close();
process.exit(0);
