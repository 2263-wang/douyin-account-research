// 浏览器生命周期管理：让独立脚本也能自己收尾，不用靠人记着关
//
// 背景（踩过的坑）：run.mjs 会自己关浏览器，但 launch / fetch-detail / transcribe /
// resolve-share 这些独立脚本不会 —— 于是跑完就留一个窗口在桌面上。
// 根因是"生命周期没人负责"，所以这里做成统一的：脚本结束就关。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowserByProfile, findBrowser } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(HERE, '..', 'launch.mjs');
const CLOSER = path.join(HERE, '..', 'close-browser.mjs');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const portOf = (port = 9222) => `http://127.0.0.1:${port}/json/version`;

export async function isBrowserUp(port = 9222) {
  try {
    const r = await fetch(portOf(port), { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

/** 起浏览器（detached），等端口就绪。用于"没起就自动起"的场景 */
export function spawnLauncher({ port = 9222, url = 'https://www.douyin.com/' } = {}) {
  const child = spawn(process.execPath, [LAUNCHER, '--port', String(port), '--url', url], {
    detached: true, stdio: 'ignore',
  });
  child.unref();
  return child;
}

/** 等到有一个 douyin 页面 target 可用（刚启动时页面还没加载完，直接 fetch 会失败） */
export async function waitForDouyinPage(port = 9222, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
      const page = list.find((t) => t.type === 'page' && /douyin\.com/.test(t.url));
      if (page) {
        // 再等页面把会话/签名准备好
        await sleep(2500);
        return page;
      }
    } catch { /* 再等 */ }
    await sleep(1000);
  }
  return null;
}

/**
 * 保证浏览器可用：已经在跑就直接用；没跑就先自己起，并等到页面可用。
 * @returns {{ started: boolean, port: number }}
 */
export async function ensureBrowser({ port = 9222, url, settleMs = 2500 } = {}) {
  let started = false;
  if (!(await isBrowserUp(port))) {
    console.log('[browser] 检测到浏览器没在跑，先启动一个…');
    spawnLauncher({ port, url });
    started = true;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      if (await isBrowserUp(port)) break;
    }
    if (!(await isBrowserUp(port))) {
      throw new Error(`浏览器 ${port} 端口 25 秒内没就绪。手动跑：node scripts/launch.mjs`);
    }
  }
  // 关键：就算端口通了，页面也可能还没落到 douyin.com —— 此时在页面里 fetch 会 Failed to fetch
  const page = await waitForDouyinPage(port);
  if (!page) {
    throw new Error(`端口 ${port} 通了，但 30 秒内没有可用的抖音页面。手动跑：node scripts/launch.mjs 确认窗口正常`);
  }
  return { started, port };
}

/**
 * 注册"脚本退出时关闭浏览器"的收尾动作。
 * 用法：在脚本开头调用 registerCleanup({ keep })，它会挂上 exit/SIGINT 钩子。
 * @param {{keep?: boolean, port?: number, toolkit?: string}} opts
 */
export function registerCleanup({ keep = false, toolkit } = {}) {
  if (keep) {
    console.log('[cleanup] --keep-browser：不关浏览器。用完请手动关：node scripts/close-browser.mjs');
    return;
  }
  const profileDir = path.join(toolkit || path.resolve(HERE, '..', '..', 'toolkit'), 'profile');
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    try {
      const r = closeBrowserByProfile(profileDir);
      if (r.closed) console.log(`\n[cleanup] 已关闭浏览器（${r.closed} 个进程）`);
    } catch { /* 忽略 */ }
  };
  process.on('exit', run);
  process.on('SIGINT', () => { run(); process.exit(130); });
  process.on('SIGTERM', () => { run(); process.exit(143); });
}

/** 命令行里是否带了 --keep-browser */
export const wantsKeepBrowser = (argv) => argv.includes('--keep-browser');
