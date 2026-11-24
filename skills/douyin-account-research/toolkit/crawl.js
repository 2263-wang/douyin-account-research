// dsh-browser-crawl.js — drive a live Chrome over CDP (no Playwright needed).
// Requires Chrome started with --remote-debugging-port=<port> and a persistent --user-data-dir.
//
//   node crawl.js launch                 start Chrome (persistent profile) on port 9222
//   node crawl.js tabs                   list open tabs
//   node crawl.js goto <url>             navigate the first page tab
//   node crawl.js text                   dump visible text of the active tab
//   node crawl.js scroll <n>             scroll the inner container n times, collect video ids
//   node crawl.js close                  close the page tab
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE = join(HERE, 'profile');

const [, , cmd = 'tabs', arg1] = process.argv;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 跨平台浏览器定位：DSH_BROWSER 覆盖 > Windows/macOS/Linux 常见安装位置
const findChrome = () => {
  if (process.env.DSH_BROWSER && existsSync(process.env.DSH_BROWSER)) return process.env.DSH_BROWSER;
  const plat = process.platform;
  let c = [];
  if (plat === 'win32') {
    c = [
      `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
  } else if (plat === 'darwin') {
    const home = process.env.HOME || '';
    c = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      try { c.push(execFileSync('which', [n], { encoding: 'utf8' }).trim()); } catch { /* 没装 */ }
    }
  }
  return c.find((p) => p && existsSync(p));
};

async function cdpUrl() {
  const r = await fetch(`${BASE}/json/version`);
  return (await r.json()).webSocketDebuggerUrl;
}

class Session {
  static #n = 0;
  #ws; #pending = new Map(); #events = new Map();
  constructor(ws) { this.#ws = ws; }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws error: ' + url)), { once: true });
    });
    const s = new Session(ws);
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id != null) {
        const p = s.#pending.get(m.id);
        if (!p) return;
        s.#pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      } else if (m.method) {
        (s.#events.get(m.method) || []).forEach((f) => f(m.params));
      }
    });
    return s;
  }
  send(method, params = {}) {
    const id = ++Session.#n;
    return new Promise((res, rej) => {
      this.#pending.set(id, { res, rej });
      this.#ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pending.delete(id)) rej(new Error('timeout: ' + method));
      }, 60000);
    });
  }
  on(method, fn) {
    if (!this.#events.has(method)) this.#events.set(method, []);
    this.#events.get(method).push(fn);
  }
  close() { try { this.#ws.close(); } catch {} }
}

async function connect() {
  // Connect straight to the page target's own WebSocket: page-level domains
  // (Runtime, Page, DOM) are only available there. Browser-level targets
  // (Target.*) reject Runtime.evaluate.
  const r = await fetch(`${BASE}/json/list`);
  const page = (await r.json()).find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; start Chrome first');
  return { send: await Session.open(page.webSocketDebuggerUrl), page };
}

const evaluate = async (send, expression) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

switch (cmd) {
  case 'launch': {
    const chrome = findChrome();
    if (!chrome) { console.error('Chrome/Edge not found'); process.exit(1); }
    mkdirSync(PROFILE, { recursive: true });
    const child = spawn(chrome, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run', '--no-default-browser-check',
      '--remote-allow-origins=*',
      'https://www.douyin.com/',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('launched:', chrome);
    console.log('profile :', PROFILE);
    console.log('port    :', PORT);
    break;
  }
  case 'tabs': {
    const r = await fetch(`${BASE}/json/list`);
    const list = await r.json();
    list.filter((t) => t.type === 'page').forEach((t, i) =>
      console.log(`[${i}] ${t.title}\n    ${t.url}\n    ${t.webSocketDebuggerUrl}`));
    break;
  }
  case 'goto': {
    const { send } = await connect();
    await send.send('Page.enable');
    await send.send('Page.navigate', { url: arg1 });
    await sleep(4000);
    const info = await evaluate(send.send.bind(send), `({url: location.href, title: document.title, len: document.body ? document.body.innerText.length : 0})`);
    console.log(JSON.stringify(info, null, 2));
    send.close();
    break;
  }
  case 'text': {
    const { send } = await connect();
    const body = await evaluate(send.send.bind(send), `document.body ? document.body.innerText : ''`);
    console.log(body);
    send.close();
    break;
  }
  case 'scroll': {
    const times = Number(arg1 || 5);
    const { send: conn } = await connect();
    const send = conn.send.bind(conn);
    const probe = `(() => {
      const out = { scrollTop: 0, scrollHeight: 0, found: [], bodyLen: document.body ? document.body.innerText.length : 0 };
      const anchors = [...document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]')];
      out.found = anchors.slice(0, 500).map(a => {
        const box = a.getBoundingClientRect();
        return {
          href: a.getAttribute('href'),
          text: (a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
          top: Math.round(box.top + window.scrollY),
        };
      });
      const cands = [...document.querySelectorAll('div,main,section')]
        .filter(el => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300);
      const box = cands.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (box) {
        out.scrollTop = box.scrollTop;
        out.scrollHeight = box.scrollHeight;
        out.scroller = box.className ? String(box.className).slice(0, 60) : box.tagName;
        box.scrollTop = box.scrollTop + box.clientHeight * 0.9;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
        out.scrollTop = window.scrollY;
        out.scrollHeight = document.body ? document.body.scrollHeight : 0;
        out.scroller = 'window';
      }
      return out;
    })()`;

    const seen = new Map();
    for (let i = 0; i < times; i++) {
      const p = await evaluate(send, probe);
      (p.found || []).forEach((f) => { if (f.href && !seen.has(f.href)) seen.set(f.href, f); });
      console.log(`[scroll ${i + 1}/${times}] scroller=${p.scroller || '-'} y=${p.scrollTop}/${p.scrollHeight} bodyLen=${p.bodyLen} items=${seen.size}`);
      await sleep(1800);
    }
    const items = [...seen.values()].map((v) => ({
      ...v,
      id: (v.href.match(/\/(?:video|note)\/(\d+)/) || [])[1] || null,
    }));
    const outFile = join(HERE, 'videos.json');
    writeFileSync(outFile, JSON.stringify({ url: await evaluate(send, 'location.href'), count: items.length, items }, null, 2), 'utf8');
    console.log('\ncollected:', items.length, '->', outFile);
    items.slice(0, 40).forEach((v, i) => console.log(`  [${i + 1}] ${v.text || '(no text)'}`));
    conn.close();
    break;
  }
  case 'search': {
    // search Douyin users by keyword and list candidate accounts
    const kw = arg1;
    if (!kw) { console.log('usage: node crawl.js search "<keyword>"'); break; }
    const { send: conn } = await connect();
    const send = conn.send.bind(conn);
    await send('Page.enable');
    await send('Page.navigate', { url: `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=user` });
    await sleep(7500);
    const EXPR = `(() => {
      const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
      const seen = new Map();
      for (const a of document.querySelectorAll('a[href*="/user/"]')) {
        const href = a.getAttribute('href') || '';
        const sec = (href.match(/\\/user\\/([\\w-]+)/) || [])[1];
        if (!sec || sec === 'self' || seen.has(sec)) continue;
        const box = a.closest('li') || a.parentElement;
        const t = txt((box || a).innerText);
        if (!t || t.length < 6) continue;
        seen.set(sec, { sec, text: t.slice(0, 200) });
      }
      return { keyword: ${JSON.stringify(kw)}, url: location.href, count: seen.size, rows: [...seen.values()] };
    })()`;
    const r = await evaluate(send, EXPR);
    console.log(`=== ${kw} (${r.count}) ===`);
    (r.rows || []).forEach((row) => {
      const m = row.text.match(/([\d.]+万?)\s*获赞\s*([\d.]+万?)\s*粉丝/);
      console.log(`  ${row.sec}`);
      console.log(`    ${m ? `赞${m[1]} 粉${m[2]}` : '?'}  ${row.text.slice(0, 120)}`);
    });
    conn.close();
    break;
  }
  case 'close': {
    const raw = await Session.open(await cdpUrl());
    const { targetInfos } = await raw.send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    if (page) await raw.send('Target.closeTarget', { targetId: page.targetId });
    raw.close();
    break;
  }
  default:
    console.log('unknown command:', cmd);
}
