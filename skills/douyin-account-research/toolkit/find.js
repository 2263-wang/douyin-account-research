// find.js — go to Douyin search, open the "用户" tab, and list matching accounts
// (name / handle / follower count / canonical profile link).
//
//   node find.js "关键词"
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const kw = process.argv[2];
if (!kw) { console.error('usage: node find.js <keyword>'); process.exit(1); }

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

await s.send('Page.enable');
const target = `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=user`;
console.log('navigating:', target);
await s.send('Page.navigate', { url: target });
await sleep(7000);

const EXPR = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const anchors = [...document.querySelectorAll('a[href*="/user/"]')];
  const rows = anchors.map((a) => {
    const box = a.closest('li,div');
    return { href: a.getAttribute('href'), text: txt((box || a).innerText).slice(0, 160) };
  }).filter((r) => r.text);
  const popup = txt(document.body.innerText).slice(0, 300);
  return {
    url: location.href,
    found: rows.length,
    rows: rows.slice(0, 20),
    bodyHead: popup,
  };
})()`;

const r = await ev(EXPR);
console.log(JSON.stringify(r, null, 2));
s.ws.close();
process.exit(0);
