// engagement.js — read like/comment/collect/share counts off video pages and
// compute the ratios, so claims about "fake engagement" can be tested against a baseline.
//   node engagement.js <id1,id2,...> <out.json>
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
const outFile = process.argv[3] || join(HERE, 'engagement.json');
if (!ids.length) { console.error('usage: node engagement.js <id,id,...> <out.json>'); process.exit(1); }

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

// Douyin's detail page exposes data-e2e hooks for each action button.
const EXPR = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const read = (e2e) => {
    const el = document.querySelector('[data-e2e="' + e2e + '"]');
    if (!el) return null;
    // the number usually lives in a nested span
    const t = txt(el.innerText) || txt(el.getAttribute('aria-label')) || '';
    const m = t.match(/([\\d.]+\\s*[万亿]?)/);
    return m ? m[1].replace(/\\s+/g, '') : (t || null);
  };
  const out = {
    url: location.href,
    title: txt(document.title),
    digg: read('video-player-digg') || read('like-icon'),
    comment: read('comment-icon') || read('feed-comment-icon'),
    collect: read('video-player-collect'),
    share: read('video-player-share'),
    play: read('video-play-count') || read('video-views'),
    raw: {},
  };
  // fall back: scan aria-labels of the action bar
  for (const e2e of ['video-player-digg','video-player-collect','video-player-share','feed-comment-icon']) {
    const el = document.querySelector('[data-e2e="' + e2e + '"]');
    out.raw[e2e] = el ? txt(el.innerText + ' | ' + (el.getAttribute('aria-label') || '')) : null;
  }
  const body = txt(document.body.innerText);
  out.bodyHead = body.slice(0, 300);
  return out;
})()`;

const results = [];
await s.send('Page.enable');
for (const [i, id] of ids.entries()) {
  await s.send('Page.navigate', { url: `https://www.douyin.com/video/${id}` });
  await sleep(5000);
  const r = await ev(EXPR);
  results.push({ id, ...(r || {}) });
  console.log(`[${i + 1}/${ids.length}] ${id}`);
  if (r) {
    console.log(`   赞${r.digg || '?'}  评${r.comment || '?'}  藏${r.collect || '?'}  转${r.share || '?'}  播${r.play || '?'}`);
    if (r.raw) Object.entries(r.raw).forEach(([k, v]) => { if (v) console.log(`     ${k}: ${v.slice(0, 60)}`); });
  }
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8');
  await sleep(2500);
}
console.log(`\n-> ${outFile}`);
s.ws.close();
process.exit(0);
