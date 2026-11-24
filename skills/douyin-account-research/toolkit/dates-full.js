// dates-full.js — resolve publish dates for every work, writing to disk directly
// (no shell piping, so the process is never killed mid-run).
//   node dates-full.js <works.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inFile = process.argv[2] || join(HERE, 'works.json');
const outFile = process.argv[3] || join(HERE, 'dates.json');
const startAt = Number(process.argv[4] || 0);

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
if (!page) { console.error('no page — run start.ps1'); process.exit(1); }
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (e) => {
  const r = await s.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return null;
  return r.result.value;
};

const INFO = `(() => {
  const meta = (p) => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? m.getAttribute('content') : null; };
  const body = (document.body ? document.body.innerText : '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ');
  return {
    url: location.href,
    published: meta('article:published_time'),
    abs: (body.match(/(20\\d{2}-\\d{2}-\\d{2})/) || [])[1] || null,
    rel: (body.match(/(\\d+\\s*(?:天|小时|分钟|月|年)前|昨天|前天)/) || [])[1] || null,
  };
})()`;

const works = JSON.parse(readFileSync(inFile, 'utf8')).items;
const out = [];
await s.send('Page.enable');

for (let i = 0; i < works.length; i++) {
  const w = works[i];
  if (i < startAt) {
    // keep already-collected rows from a previous run if present
    try {
      const prev = JSON.parse(readFileSync(outFile, 'utf8'));
      const hit = prev.results.find((p) => p.id === w.id);
      if (hit) { out.push(hit); continue; }
    } catch {}
    continue;
  }
  // navigate on the top-level page (video detail is a sub-route)
  await s.send('Page.navigate', { url: w.href });
  await sleep(2000);
  let info = null;
  for (let t = 0; t < 6; t++) {
    info = await ev(INFO);
    if (info && (info.published || info.abs)) break;
    await sleep(700);
  }
  const row = {
    id: w.id,
    title: w.title,
    play: w.play,
    published: info ? info.published : null,
    abs: info ? info.abs : null,
    rel: info ? info.rel : null,
  };
  out.push(row);
  if (i % 5 === 0 || i === works.length - 1) {
    writeFileSync(outFile, JSON.stringify({ scrapedAt: new Date().toISOString(), count: out.length, results: out }, null, 2), 'utf8');
    console.log(`[${i + 1}/${works.length}] saved (${out.filter((r) => r.published || r.abs).length} dated)`);
  }
}

writeFileSync(outFile, JSON.stringify({ scrapedAt: new Date().toISOString(), count: out.length, results: out }, null, 2), 'utf8');
console.log(`done: ${out.length} rows -> ${outFile}`);
s.ws.close();
process.exit(0);
