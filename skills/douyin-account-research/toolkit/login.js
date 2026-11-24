// dsh-browser-login.js — start a persistent debug Chrome and wait until Douyin is logged in.
//
//   node login.js            start Chrome (if needed) on port 9222 and poll login state
//   node login.js --status   only report current login state
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE = join(HERE, 'profile');
const seenArg = process.argv.slice(2);
const STATUS_ONLY = seenArg.includes('--status');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 跨平台浏览器定位：DSH_BROWSER 覆盖 > Windows/macOS/Linux 常见安装位置
const findChrome = () => {
  if (process.env.DSH_BROWSER && existsSync(process.env.DSH_BROWSER)) return process.env.DSH_BROWSER;
  let c = [];
  if (process.platform === 'win32') {
    c = [
      `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    c = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  } else {
    const which = (n) => {
      const r = spawnSync('which', [n], { encoding: 'utf8' });
      return r.status === 0 ? String(r.stdout || '').trim() : null;
    };
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      const p = which(n);
      if (p) c.push(p);
    }
  }
  return c.find((p) => p && existsSync(p));
};

const alive = async () => {
  try { const r = await fetch(`${BASE}/json/version`); return r.ok; } catch { return false; }
};

const sessionInfo = (() => {
  // Same minimal CDP client as crawl.js, kept inline so this file stands alone.
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
  return S;
})();

async function firstPage() {
  const r = await fetch(`${BASE}/json/list`);
  const pages = (await r.json()).filter((t) => t.type === 'page');
  return pages[0] || null;
}

const BOOT_EXPR = `(() => {
  const t = document.body ? document.body.innerText : '';
  const url = location.href;
  const avatars = document.querySelectorAll('img[src*="aweme-avatar"], img[src*="douyinpic"]').length;
  const hasLoginWord = /登录/.test(t.replace(/[\u200b-\u200f\ufeff]/g, ''));
  const hasMy = /我的/.test(t);
  const captcha = /captcha|安全验证|滑动验证/.test(url) || /请完成安全验证|拖动滑块/.test(t);
  const loggedOut = url.includes('/login') || captcha || hasLoginWord;
  return {
    url,
    hosting: url.includes('douyin'),
    avatars,
    loggedOut,
    textLen: t.length,
    head: t.replace(/\\s+/g, ' ').slice(0, 80),
  };
})()`;

async function loginState() {
  const page = await firstPage();
  if (!page) return { ok: false, why: 'no page tab' };
  const s = await sessionInfo.open(page.webSocketDebuggerUrl);
  try {
    const r = await s.send('Runtime.evaluate', { expression: BOOT_EXPR, returnByValue: true });
    return { ok: true, ...(r.result.value || {}) };
  } finally { try { s.ws.close(); } catch {} }
}

if (!STATUS_ONLY && !(await alive())) {
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome/Edge not found'); process.exit(1); }
  mkdirSync(PROFILE, { recursive: true });
  const child = spawn(chrome, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    'https://www.douyin.com/',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('[login] chrome launched');
  console.log('[login] exe    :', chrome);
  console.log('[login] profile:', PROFILE);
  console.log('[login] port   :', PORT);
  for (let i = 0; i < 30 && !(await alive()); i++) await sleep(500);
}

let state = await loginState();
console.log('[login] state  :', JSON.stringify(state));

if (STATUS_ONLY) process.exit(state.loggedOut ? 2 : 0);

if (state.loggedOut) {
  console.log('\n>>> 请在弹出的 Chrome 窗口里扫码登录抖音。我在轮询，登录成功后会自动退出。\n');
  for (let i = 1; i <= 60; i++) {
    await sleep(5000);
    state = await loginState();
    console.log(`[login] poll ${i}/60 :`, state.url ? state.url.slice(0, 60) : state.why, '| loggedOut=', state.loggedOut);
    if (state.ok && state.hosting && !state.loggedOut) break;
  }
}

console.log('\n[login] final  :', JSON.stringify(state));
process.exit(state.ok && state.hosting && !state.loggedOut ? 0 : 3);
