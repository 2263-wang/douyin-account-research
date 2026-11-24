// 跨平台浏览器定位与进程管理（Windows / macOS / Linux）
// 用法:
//   import { findBrowser, browserArgs, closeBrowserByProfile, profileDirFor } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

/**
 * 浏览器查找分两级，顺序明确：
 *   1) 优先 Chromium 系（Chrome / Chromium / Brave / Vivaldi / Opera）——兼容性最好
 *   2) 其次 Edge——Windows 基本自带，保证"没装 Chrome 也能用"
 * 两级都找不到，才让用户去装。
 */
const CHROMIUM_APPS = {
  win: [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Google', 'Chrome Beta', 'Application', 'chrome.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ['Vivaldi', 'Application', 'vivaldi.exe'],
    ['Opera', 'launcher.exe'],
  ],
  edge: [['Microsoft', 'Edge', 'Application', 'msedge.exe']],
};
const MAC_APPS = ['Google Chrome', 'Google Chrome Beta', 'Chromium', 'Brave Browser', 'Vivaldi', 'Opera'];
const LINUX_BINS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'vivaldi', 'opera'];
// macOS 上 Chromium 的可执行名和 .app 名不同
const MAC_EXE_ALIAS = { Chromium: 'Chromium' };

function roots() {
  if (isWin) {
    const home = os.homedir();
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      local,
    ];
  }
  if (isMac) return ['/Applications', path.join(os.homedir(), 'Applications')];
  return [];
}

function whichBin(name) {
  try { return execFileSync('which', [name], { encoding: 'utf8', timeout: 8000 }).trim(); } catch { return null; }
}

/** 第一级：Chromium 系（不含 Edge） */
export function chromiumFamilyCandidates() {
  if (isWin) {
    const out = [];
    for (const root of roots()) for (const seg of CHROMIUM_APPS.win) out.push(path.join(root, ...seg));
    return out;
  }
  if (isMac) {
    const out = [];
    for (const root of roots()) {
      for (const a of MAC_APPS) out.push(path.join(root, `${a}.app`, 'Contents', 'MacOS', MAC_EXE_ALIAS[a] || a));
    }
    return out;
  }
  return LINUX_BINS.map(whichBin).filter(Boolean);
}

/** 第二级：Edge */
export function edgeCandidates() {
  if (isWin) {
    const out = [];
    for (const root of roots()) for (const seg of CHROMIUM_APPS.edge) out.push(path.join(root, ...seg));
    return out;
  }
  if (isMac) {
    const out = [];
    for (const root of roots()) out.push(path.join(root, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'));
    return out;
  }
  return ['microsoft-edge', 'microsoft-edge-stable'].map(whichBin).filter(Boolean);
}

/** 全部候选（供报错时展示），Chromium 系在前、Edge 在后 */
export function browserCandidates() {
  return [...chromiumFamilyCandidates(), ...edgeCandidates()];
}

/** 只看存在的候选，便于报错时展示 */
export function existingBrowserCandidates() {
  return browserCandidates().filter((p) => {
    try { return p && fs.existsSync(p); } catch { return false; }
  });
}

const firstExisting = (list) => {
  for (const p of list) { try { if (p && fs.existsSync(p)) return p; } catch { /* 忽略 */ } }
  return null;
};

/**
 * 返回可用的浏览器。
 * @param {{prefer?: 'auto'|'chromium'|'edge'}} opts
 *   prefer='auto'（默认）：Chromium 系优先，没有则用 Edge
 *   prefer='edge'：直接用 Edge（调试时想确认 Edge 也能跑）
 */
export function findBrowser({ prefer = 'auto' } = {}) {
  if (prefer === 'edge') return firstExisting(edgeCandidates());
  return firstExisting(chromiumFamilyCandidates()) || firstExisting(edgeCandidates());
}

/** 找到的是哪一类，用于日志 */
export function browserKind(p) {
  if (!p) return 'none';
  return edgeCandidates().includes(p) ? 'edge' : 'chromium';
}

/** 各平台通用的启动参数 */
export function browserArgs({ port = 9222, profileDir, url = 'https://www.douyin.com/' }) {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    url,
  ];
}

/** 每个工具链实例自己的 profile 目录（放在该实例目录下，保持隔离） */
export function profileDirFor(toolkitDir) {
  return path.join(toolkitDir, 'profile');
}

/**
 * 关闭某个 profile 对应的浏览器进程。
 * 按 profile 路径匹配命令行，只关自己起的，不碰用户自己的浏览器。
 * Windows 用 CIM+taskkill；macOS/Linux 用 ps + kill。
 */
export function closeBrowserByProfile(profileDir) {
  const hint = path.resolve(profileDir);
  const base = path.basename(path.dirname(hint));   // 工具链目录名，用于二次确认
  let pids = [];
  try {
    if (isWin) {
      // Windows 上 execFileSync 不会补 .exe，写 'powershell' 会 ENOENT（PATH 里 System32 未必生效）
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${base}*' -and $_.CommandLine -like '*profile*' } | ` +
        `Select-Object -ExpandProperty ProcessId`,
      ], { encoding: 'utf8', timeout: 60000 });
      pids = out.split(/\s+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      for (const pid of pids) {
        try { execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore', timeout: 20000 }); } catch { /* 已退出 */ }
      }
    } else {
      const out = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 30000 });
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(.*)$/);
        if (!m) continue;
        const [, pid, cmd] = m;
        if (!/Chrome|Chromium|Edge|Brave/i.test(cmd)) continue;
        // 必须同时命中完整 user-data-dir 路径与工具链目录名，避免误杀用户自己的浏览器
        if (!cmd.includes(hint) && !(cmd.includes(base) && cmd.includes('--user-data-dir'))) continue;
        pids.push(pid);
      }
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch { /* 已退出 */ }
      }
    }
  } catch (e) {
    return { closed: 0, error: String(e.message).split('\n')[0] };
  }
  return { closed: pids.length };
}

/** 平台版本的说明串，用于日志 */
export function platformLabel() {
  const b = findBrowser();
  return `${process.platform} ${os.release()} | browser=${b || '未找到'}`;
}
