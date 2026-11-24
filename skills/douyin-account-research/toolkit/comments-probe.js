// comments-probe.js — inspect the comment panel DOM on a Douyin video page.
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const url = process.argv[2];
if (url) {
  await s.send('Page.enable');
  await s.send('Page.navigate', { url });
  await sleep(5000);
}

const P = `(() => {
  const out = {};
  out.e2e = [...new Set([...document.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e')))];
  out.commentish = out.e2e.filter(v => /comment/i.test(v));
  const panel = document.querySelector('[data-e2e="comment-list"]') ||
                document.querySelector('[class*="comment"]');
  out.panelFound = !!panel;
  if (panel) {
    out.panelCls = String(panel.className).slice(0, 70);
    out.panelHtml = panel.outerHTML.slice(0, 1200);
    out.childCount = panel.children.length;
  }
  const btns = [...document.querySelectorAll('div,span,button')]
    .filter(e => /展开|更多回复|查看\\d+条回复/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 20);
  out.expandButtons = btns.slice(0, 5).map(e => ({ tag: e.tagName, text: e.innerText.trim().slice(0, 20), cls: String(e.className).slice(0, 50) }));
  return out;
})()`;

console.log(JSON.stringify(await ev(P), null, 2));
s.ws.close();
process.exit(0);
