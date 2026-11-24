// comments.js — scrape the comment panel of every video in a works file.
//   node comments.js <works.json|url> [outFile] [maxScrolls]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const input = process.argv[2] || join(HERE, 'works.json');
const outFile = process.argv[3] || join(HERE, 'comments.json');
const maxScrolls = Number(process.argv[4] || 6);

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
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// One pass: expand reply buttons, read all comment items, scroll the panel.
const PASS = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  // click any "展开" reply toggles (bounded)
  let clicked = 0;
  for (const b of document.querySelectorAll('div,button')) {
    const t = txt(b.innerText);
    if (clicked < 40 && /^(展开|展开\\d+条回复|更多回复|展开更多)$/.test(t)) { try { b.click(); clicked++; } catch {} }
  }
  const items = [];
  for (const it of document.querySelectorAll('[data-e2e="comment-item"]')) {
    const t = txt(it.innerText);
    if (!t) continue;
    const a = it.querySelector('a[href*="/user/"]');
    const like = (t.match(/(\\d+(?:\\.\\d+)?万?)\\s*$/) || [])[1] || null;
    const meta = (t.match(/(\\d+[天小时分秒]+前|\\d+月前|昨天|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2})[^ ]*(·[^ ]+)?/) || [])[0] || null;
    items.push({
      author: a ? txt(a.innerText) : null,
      authorUrl: a ? a.getAttribute('href') : null,
      text: t.slice(0, 400),
      meta,
      like,
      isReply: !!it.closest('[class*="reply"]'),
    });
  }
  const panel = document.querySelector('[data-e2e="comment-list"]');
  const scroller = panel ? (panel.closest('[class*="comment"]') || panel) : null;
  let scrolled = 0;
  const cands = [...document.querySelectorAll('div')]
    .filter((el) => el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 250)
    .sort((a, b) => b.clientHeight - a.clientHeight);
  if (cands[0]) { cands[0].scrollTop += cands[0].clientHeight * 0.8; scrolled = Math.round(cands[0].scrollTop); }
  return { items, clicked, scrolled, total: document.querySelectorAll('[data-e2e="comment-item"]').length };
})()`;

const jobs = input.startsWith('http')
  ? [{ href: input, title: input }]
  : JSON.parse(readFileSync(input, 'utf8')).items.map((w) => ({ href: w.href, title: w.title, play: w.play }));

const out = [];
await s.send('Page.enable');

for (const [i, job] of jobs.entries()) {
  await s.send('Page.navigate', { url: job.href });
  await sleep(5200);
  const all = new Map();
  for (let k = 0; k < maxScrolls; k++) {
    const r = await ev(PASS);
    (r.items || []).forEach((c) => { const key = (c.author || '') + '|' + (c.text || '').slice(0, 60); if (!all.has(key)) all.set(key, c); });
    if (k === maxScrolls - 1) break;
    await sleep(1500);
  }
  const comments = [...all.values()];
  out.push({ videoUrl: job.href, title: job.title, play: job.play, count: comments.length, comments });
  console.log(`[${i + 1}/${jobs.length}] comments=${comments.length}  ${(job.title || '').slice(0, 44)}`);
}

writeFileSync(outFile, JSON.stringify({ scrapedAt: new Date().toISOString(), videos: out }, null, 2), 'utf8');
console.log(`\nwrote -> ${outFile}`);
console.log('\n===== 评论抽样 =====');
out.forEach((v) => {
  console.log(`\n--- ${(v.title || '').slice(0, 50)} (${v.count}) ---`);
  v.comments.slice(0, 6).forEach((c) => console.log(`  · [${c.like || '-'}] ${c.text.slice(0, 100)}`));
});
s.ws.close();
process.exit(0);
