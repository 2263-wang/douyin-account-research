// authors.js — for each video id, open its page and read the author profile link.
//   node authors.js <idFile|comma-separated ids> <out.json>
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = process.argv[2];
const outFile = process.argv[3] || join(HERE, 'authors.json');
let ids;
if (src && src.endsWith('.json')) {
  ids = JSON.parse(readFileSync(src, 'utf8'));
} else {
  ids = (src || '').split(',').map((x) => x.trim()).filter(Boolean);
}
if (!ids.length) { console.error('no ids'); process.exit(1); }

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
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('timeout ' + m)); }, 25000);
    });
  }
}

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page — run launch.ps1'); process.exit(1); }
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (e) => {
  const r = await s.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return null;
  return r.result.value;
};

const EXPR = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const out = { url: location.href, title: txt(document.title), authors: [], stats: null };
  for (const a of document.querySelectorAll('a[href*="/user/"]')) {
    const sec = (a.getAttribute('href').match(/\\/user\\/([\\w-]+)/) || [])[1];
    if (!sec || sec === 'self') continue;
    const box = a.closest('div[class]') || a;
    out.authors.push({ sec, text: txt(box.innerText).slice(0, 120) });
    if (out.authors.length >= 3) break;
  }
  const body = txt(document.body.innerText);
  out.stats = (body.match(/([\\d.]+万?)\\s*粉丝/) || [])[0] || null;
  out.head = body.slice(0, 200);
  return out;
})()`;

const results = [];
await s.send('Page.enable');
for (const [i, id] of ids.entries()) {
  await s.send('Page.navigate', { url: `https://www.douyin.com/video/${id}` });
  await sleep(4200);
  const r = await ev(EXPR);
  const author = r?.authors?.[0] || null;
  results.push({ videoId: id, authorSec: author?.sec || null, authorText: author?.text || null, stats: r?.stats || null, title: r?.title || null });
  console.log(`[${i + 1}/${ids.length}] ${id}  ->  ${author ? author.sec.slice(0, 26) : 'NOT FOUND'}  ${author ? author.text.slice(0, 50) : ''}`);
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8');
  await sleep(2200);
}
console.log(`\n-> ${outFile}`);
s.ws.close();
process.exit(0);
