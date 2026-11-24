// probe3.js — find the real card structure inside [data-e2e="user-post-list"]
import { existsSync } from 'node:fs';

const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;

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

const P = `(() => {
  const scope = document.querySelector('[data-e2e="user-post-list"]');
  const out = {};
  if (!scope) return { error: 'no user-post-list' };
  out.scopeTag = scope.tagName;
  out.scopeCls = String(scope.className).slice(0, 80);
  out.scopeChildCount = scope.children.length;
  out.scopeHtmlHead = scope.outerHTML.slice(0, 900);
  const links = [...scope.querySelectorAll('[href*="/video/"]')];
  out.linkCount = links.length;
  out.linkSample = links.slice(0, 3).map((a) => ({
    tag: a.tagName,
    cls: String(a.className).slice(0, 60),
    href: a.getAttribute('href'),
    attrs: [...a.attributes].map((x) => x.name),
  }));
  // find the repeated container: element whose parent has many identical-class children
  const first = links[0];
  if (first) {
    let el = first;
    const chain = [];
    for (let i = 0; i < 5 && el; i++) {
      chain.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 70),
        childCount: el.children.length,
        attrsWithData: [...el.attributes].filter((x) => x.name.startsWith('data-')).map((x) => x.name),
        text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 90),
      });
      el = el.parentElement;
    }
    out.chain = chain;
  }
  return out;
})()`;

console.log(JSON.stringify(await ev(P), null, 2));
s.ws.close();
process.exit(0);
