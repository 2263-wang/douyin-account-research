// dates.js — read publish dates straight off the profile page (no per-video navigation).
// The video id also encodes time; we calibrate the id->date mapping against the
// dates the page renders, then use it for every card.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 参数可以是 secUid、主页 URL 或作品页 URL —— 统一成一个可导航的 URL
// （历史 bug：直接把 secUid 喂给 Page.navigate，报 "Cannot navigate to invalid URL"）
const rawArg = process.argv[2] || 'https://www.douyin.com/user/MS4wLjABAAAAwbbVuf1W2DdgRe0xCa0oxg1ZIHbzuiTzyjq3NcOVgBuu6qIidYlMYqbL3ZFY2swu';
const url = rawArg.startsWith('http') ? rawArg : `https://www.douyin.com/user/${rawArg}`;
const outFile = process.argv[3] || join(HERE, 'dates-out.json');

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
const ev = async (e) => {
  const r = await s.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await s.send('Page.enable');
await s.send('Page.navigate', { url });
await sleep(7000);

// scroll to load every card
for (let i = 0; i < 20; i++) {
  await ev(`(() => {
    const c = [...document.querySelectorAll('div,main,section')]
      .filter(el => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300)
      .sort((a,b) => b.clientHeight - a.clientHeight)[0];
    if (c) c.scrollTop += c.clientHeight * 0.9; else window.scrollTo(0, document.body.scrollHeight);
    return 1;
  })()`);
  await sleep(1100);
}

const OUT = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const scope = document.querySelector('[data-e2e="user-post-list"]') || document;
  const out = [];
  for (const li of scope.querySelectorAll('li')) {
    const a = li.querySelector('a[href*="/video/"]');
    if (!a) continue;
    const id = (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1];
    if (!id) continue;
    const t = txt(li.innerText);
    out.push({
      id,
      text: t.slice(0, 120),
      // 卡片上的相对日期，如 "3天前" / "2026-09-20" / "1周前"
      rel: (t.match(/(\\d+[秒分时天周月]前|昨天|前天|\\d{4}[-.]\\d{1,2}[-.]\\d{1,2}|\\d{1,2}[-.]\\d{1,2})/) || [])[1] || null,
      html: li.outerHTML.slice(0, 400),
    });
  }
  return { count: out.length, items: out };
})()`;

const scraped = await ev(OUT);

// 作品 id 高位 32 bit 是发布时间的 unix 秒（抖音雪花 id）。
// 逐条推算绝对日期，作为 abs 字段写入——编排器 applyWindow() 正是读这个字段。
const idToDate = (id) => {
  try {
    const t = Number(BigInt(id) >> 32n);
    const d = new Date(t * 1000);
    return d.getFullYear() > 2016 && d.getFullYear() < 2100 ? d.toISOString().slice(0, 10) : null;
  } catch { return null; }
};

const results = (scraped.items || []).map((it) => ({
  id: String(it.id),
  title: it.text || '',
  rel: it.rel || '',
  abs: idToDate(it.id),
  kind: 'id-encoded',
}));

writeFileSync(outFile, JSON.stringify({
  source: url, scrapedAt: new Date().toISOString(), count: results.length, results,
}, null, 2), 'utf8');

console.log(JSON.stringify({ count: scraped.count, sample: results.slice(0, 5) }, null, 2));
const dated = results.filter((r) => r.abs);
if (dated.length) {
  const ds = dated.map((r) => r.abs).sort();
  console.log(`日期范围: ${ds[0]} ~ ${ds[ds.length - 1]}`);
}
console.log(`wrote ${results.length} -> ${outFile}`);
s.ws.close();
process.exit(0);
