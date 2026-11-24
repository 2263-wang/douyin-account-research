// vsrch.js — search Douyin VIDEOS by keyword (not users), list the accounts behind them.
// Keywords must be passed via the DSH_KW environment variable, because Windows
// PowerShell 5.1 mangles non-ASCII command-line arguments into GBK mojibake.
//   $env:DSH_KW='AI原理'; node vsrch.js
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const kw = process.env.DSH_KW;
if (!kw) { console.error('set DSH_KW env var first'); process.exit(1); }

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
await s.send('Page.navigate', { url: `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=video` });
await sleep(8000);

const PROBE = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const out = { url: location.href, kw: ${JSON.stringify(kw)}, cards: [], users: [] };
  const seenV = new Set();
  for (const a of document.querySelectorAll('a[href*="/video/"]')) {
    const id = (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1];
    if (!id || seenV.has(id)) continue;
    seenV.add(id);
    const li = a.closest('li') || a.parentElement;
    out.cards.push({ id, text: txt((li || a).innerText).slice(0, 260) });
  }
  for (const a of document.querySelectorAll('a[href*="/user/"]')) {
    const sec = (a.getAttribute('href').match(/\\/user\\/([\\w-]+)/) || [])[1];
    if (!sec || sec === 'self') continue;
    const li = a.closest('li') || a.parentElement;
    out.users.push({ sec, text: txt((li || a).innerText).slice(0, 120) });
  }
  return out;
})()`;

let r = await ev(PROBE);
for (let i = 0; i < 3; i++) {
  await ev(`(() => { const c=[...document.querySelectorAll('div,main,section')].filter(e=>e.scrollHeight>e.clientHeight+200&&e.clientHeight>300).sort((a,b)=>b.clientHeight-a.clientHeight)[0]; if(c) c.scrollTop+=c.clientHeight*0.9; else window.scrollTo(0,document.body.scrollHeight); return 1; })()`);
  await sleep(1800);
}
const r2 = await ev(PROBE);
const cards = new Map();
[...(r?.cards || []), ...(r2?.cards || [])].forEach((c) => { if (!cards.has(c.id)) cards.set(c.id, c); });

console.log(`keyword: ${kw}`);
console.log(`videos found: ${cards.size}\n`);
[...cards.values()].slice(0, 30).forEach((c, i) => {
  console.log(`[${String(i + 1).padStart(2)}] ${c.text.slice(0, 150)}`);
});

const safe = kw.replace(/[^\w\u4e00-\u9fa5]/g, '_');
const outFile = join(HERE, `vsearch-${safe}.json`);
writeFileSync(outFile, JSON.stringify({ keyword: kw, at: new Date().toISOString(), count: cards.size, cards: [...cards.values()], users: r2?.users || [] }, null, 2), 'utf8');
console.log(`\n-> ${outFile}`);
s.ws.close();
process.exit(0);
