// discover.js — find related accounts WITHOUT using the search endpoint.
// Two gentle sources:
//   1) a video page's "相关推荐" / "作者其他视频" sidebar
//   2) a profile page's "推荐" tab (accounts Douyin suggests)
//   node discover.js video <videoUrl>
//   node discover.js profile <secUid|url>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mode = process.argv[2];
const target = process.argv[3];
if (!mode || !target) { console.error('usage: node discover.js video|profile <url|secUid>'); process.exit(1); }
const url = target.startsWith('http') ? target : `https://www.douyin.com/user/${target}`;

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

await s.send('Page.enable');
await s.send('Page.navigate', { url });
await sleep(7000);

const PROBE = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const out = { url: location.href, e2e: [], users: [], videoCards: [] };
  out.e2e = [...new Set([...document.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e')))];
  // every user link on the page with its surrounding text
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/user/"]')) {
    const sec = (a.getAttribute('href').match(/\\/user\\/([\\w-]+)/) || [])[1];
    if (!sec || sec === 'self' || seen.has(sec)) continue;
    seen.add(sec);
    const box = a.closest('li,div[class]') || a;
    const t = txt(box.innerText).slice(0, 150);
    out.users.push({ sec, text: t });
  }
  // related video cards
  const vids = new Set();
  for (const a of document.querySelectorAll('a[href*="/video/"]')) {
    const id = (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1];
    if (!id || vids.has(id)) continue;
    vids.add(id);
    out.videoCards.push({ id, text: txt(a.innerText).slice(0, 120) });
  }
  // any section headers that look like recommendations
  const heads = [...document.querySelectorAll('div,span,h1,h2,h3')]
    .map(e => txt(e.innerText))
    .filter(t => t && t.length < 12 && /推荐|相关|更多|猜你|相似/.test(t));
  out.headers = [...new Set(heads)].slice(0, 10);
  return out;
})()`;

let r = await ev(PROBE);
// scroll to load lazy recommendation modules, then re-probe
for (let i = 0; i < 4; i++) {
  await ev(`(() => { const c=[...document.querySelectorAll('div,main,section')].filter(e=>e.scrollHeight>e.clientHeight+200&&e.clientHeight>300).sort((a,b)=>b.clientHeight-a.clientHeight)[0]; if(c) c.scrollTop+=c.clientHeight*0.9; else window.scrollTo(0,document.body.scrollHeight); return 1; })()`);
  await sleep(1600);
}
const r2 = await ev(PROBE);

const merge = (a, b, key) => {
  const m = new Map();
  [...(a || []), ...(b || [])].forEach((x) => { if (x && x[key]) m.set(x[key], x); });
  return [...m.values()];
};
const users = merge(r.users, r2.users, 'sec');
const vids = merge(r.videoCards, r2.videoCards, 'id');

console.log(`page: ${r2.url}`);
console.log(`headers: ${(r2.headers || []).join(' | ')}`);
console.log(`\n=== 页面上的账号链接 (${users.length}) ===`);
users.forEach((u) => console.log(`  ${u.sec}\n    ${u.text.slice(0, 120)}`));
console.log(`\n=== 相关视频 (${vids.length}) ===`);
vids.slice(0, 25).forEach((v) => console.log(`  ${v.id}  ${v.text.slice(0, 90)}`));

const outFile = join(HERE, `discover-${mode}.json`);
let prev = { runs: [] };
if (existsSync(outFile)) { try { prev = JSON.parse(readFileSync(outFile, 'utf8')); } catch {} }
prev.runs = prev.runs || [];
prev.runs.push({ mode, target: url, at: new Date().toISOString(), users, videos: vids });
writeFileSync(outFile, JSON.stringify(prev, null, 2), 'utf8');
console.log(`\n-> ${outFile}`);
s.ws.close();
process.exit(0);
