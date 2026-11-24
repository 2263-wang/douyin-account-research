// click-search.js — drive the real Douyin search box like a human:
// focus the input, type character by character, press Enter, read results.
// Keyword comes from DSH_KW (env var) to avoid PowerShell GBK mangling.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const kw = process.env.DSH_KW;
if (!kw) { console.error('set DSH_KW first'); process.exit(1); }

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
const pageRaw = list.find((t) => t.type === 'page');
if (!pageRaw) { console.error('no page — run launch.ps1'); process.exit(1); }
const s = await S.open(pageRaw.webSocketDebuggerUrl);
const ev = async (e) => {
  const r = await s.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
  return r.result.value;
};

await s.send('Page.enable');

// go home so the search box is present
const cur = await ev('location.href');
if (!/douyin\.com/.test(cur || '')) {
  await s.send('Page.navigate', { url: 'https://www.douyin.com/' });
  await sleep(6000);
}

// 1) locate the search input and click it
const FOCUS = `(() => {
  const cands = [...document.querySelectorAll('input, [contenteditable="true"], textarea')];
  const el = cands.find(e => {
    const ph = (e.getAttribute('placeholder') || e.getAttribute('aria-label') || '');
    const dt = e.getAttribute('data-e2e') || '';
    return /搜索|search/i.test(ph) || /search/i.test(dt);
  }) || cands[0];
  if (!el) return { ok: false, count: cands.length };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  el.click();
  const r = el.getBoundingClientRect();
  return {
    ok: true,
    tag: el.tagName,
    placeholder: el.getAttribute('placeholder'),
    dataE2e: el.getAttribute('data-e2e'),
    x: Math.round(r.x + r.width / 2),
    y: Math.round(r.y + r.height / 2),
    w: Math.round(r.width),
  };
})()`;

let info = await ev(FOCUS);
console.log('search input:', JSON.stringify(info));
if (!info || !info.ok) { console.error('search input not found'); process.exit(1); }

// real mouse click at the element's centre
await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
await sleep(500);

// 2) type character by character
for (const ch of kw) {
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp' });
  await sleep(190 + Math.floor(Math.random() * 130));
}
await sleep(1200);
const typed = await ev(`(() => {
  const c = [...document.querySelectorAll('input,[contenteditable="true"]')];
  const el = c.find(e => /搜索|search/i.test((e.getAttribute('placeholder')||'')+(e.getAttribute('data-e2e')||''))) || c[0];
  return el ? (el.value || el.innerText || '') : null;
})()`);
console.log('typed text now in box:', JSON.stringify(typed));

// 3) press Enter
await s.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' });
await s.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
await sleep(7000);

const after = await ev('location.href');
console.log('url after enter:', after);

// 4) read result cards
const PROBE = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const out = { url: location.href, cards: [] };
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/video/"]')) {
    const id = (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const li = a.closest('li') || a.parentElement;
    out.cards.push({ id, text: txt((li || a).innerText).slice(0, 240) });
  }
  return out;
})()`;
const res = await ev(PROBE);
console.log(`\nvideos found: ${res?.cards?.length || 0}\n`);
(res?.cards || []).slice(0, 25).forEach((c, i) => console.log(`[${String(i + 1).padStart(2)}] ${c.text.slice(0, 145)}`));

const safe = kw.replace(/[^\w\u4e00-\u9fa5]/g, '_');
const outFile = join(HERE, `clicksearch-${safe}.json`);
writeFileSync(outFile, JSON.stringify({ keyword: kw, at: new Date().toISOString(), url: res?.url, cards: res?.cards || [] }, null, 2), 'utf8');
console.log(`\n-> ${outFile}`);
s.ws.close();
process.exit(0);
