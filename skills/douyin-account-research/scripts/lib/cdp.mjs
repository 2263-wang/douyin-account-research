// CDP 最小客户端：连接用户已登录的浏览器，不引入任何依赖
// 用途：所有其他脚本共用这一份连接逻辑
import fs from 'node:fs';

export const arg = (argv, k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

export async function listTargets(port = 9222) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!r.ok) throw new Error(`CDP 端口 ${port} 无响应，先用 scripts/start-browser.ps1 起浏览器`);
  return r.json();
}

/** 挑一个可用的 page target：优先指定 URL 关键词，否则第一个非 about:blank */
export async function pickPage(port = 9222, prefer = /douyin\.com/) {
  const targets = await listTargets(port);
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const page =
    pages.find((p) => prefer.test(p.url)) ||
    pages.find((p) => !/^(about:blank|edge:|chrome:|devtools:)/.test(p.url)) ||
    pages[0];
  if (!page) throw new Error('没有可用的页面 target');
  return page;
}

export async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl); // Node 内置，不需要 ws 包
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true });
  });

  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    for (const fn of handlers) fn(m);
  });

  const send = (method, params = {}, timeout = 30000) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) { pending.delete(mid); reject(new Error(`${method} 超时`)); }
      }, timeout);
    });

  return { ws, send, on: (fn) => handlers.push(fn) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ensureDir = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };

/** 数字格式化：12345 -> 1.2万 */
export const fmtNum = (n) => (n == null ? '' : n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n));

/** 秒 -> mm:ss */
export const mmss = (s) =>
  s == null ? '' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const fmtDate = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '');

/** 写 UTF-8 文件（Node 默认就是，这里显式化避免误会） */
export const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
