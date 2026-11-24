// probe.js — inspect the live DOM to find the card structure Douyin actually uses.
import { existsSync } from 'node:fs';

const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;

let n = 0;
class S {
  constructor(ws) { this.ws = ws; this.pending = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    const s = new S(ws);
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id != null && s.pending.has(m.id)) {
        const p = s.pending.get(m.id); s.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    return s;
  }
  send(method, params = {}) {
    const id = ++n;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('timeout ' + method)); }, 30000);
    });
  }
}

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page'); process.exit(1); }

const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (expression) => {
  const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const PROBE = `(() => {
  const out = {};
  out.url = location.href;
  out.anchors = [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).slice(0, 15);
  out.li = document.querySelectorAll('li').length;
  out.dataAttrs = [...new Set([...document.querySelectorAll('*')].flatMap(el => [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-'))))].slice(0, 20);
  const txt = [...document.querySelectorAll('*')].filter(el => (el.innerText || '').includes('@') && el.children.length < 6);
  out.cardSample = txt.slice(0, 3).map(el => ({
    tag: el.tagName,
    cls: String(el.className).slice(0, 80),
    parentCls: el.parentElement ? String(el.parentElement.className).slice(0, 80) : null,
    text: el.innerText.replace(/\\s+/g, ' ').slice(0, 120),
  }));
  const li = document.querySelector('li');
  out.firstLi = li ? { cls: String(li.className).slice(0, 60), html: li.outerHTML.slice(0, 500) } : null;
  return out;
})()`;

const r = await ev(PROBE);
console.log(JSON.stringify(r, null, 2));
s.ws.close();
