// 跨平台启动带调试端口的浏览器（Windows / macOS / Linux 通用）
// 用法: node scripts/launch.mjs [--port 9222] [--url https://www.douyin.com/] [--toolkit <目录>]
//
// 为什么必须用可见窗口：headless 会被抖音判定为自动化客户端，返回"验证码中间页"。
//
// 找不到浏览器时本脚本**不会自动下载**，只提示用户去装；装好后重跑即可。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arg } from './lib/cdp.mjs';
import { findBrowser, browserKind, browserArgs, profileDirFor, browserCandidates, isWin, isMac, platformLabel } from './lib/browser.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);
const PORT = Number(arg(argv, 'port', '9222'));
const URL_ARG = arg(argv, 'url', 'https://www.douyin.com/');

const TOOLKIT = resolveToolkit({
  explicit: arg(argv, 'toolkit', '') || process.env.DSH_TOOLKIT || '',
  skillRoot: SKILL_ROOT,
}) || path.join(SKILL_ROOT, 'toolkit');
const PROFILE = profileDirFor(TOOLKIT);

/** 没找到浏览器时的提示。两级都没找到才走到这里。 */
function printBrowserHelp() {
  console.error('\n没找到可用的浏览器，无法继续。\n');
  console.error('查找顺序是：先找 Chromium 系（Chrome / Chromium / Brave / Vivaldi / Opera），');
  console.error('找不到再用 Edge。两级都没有，才需要你装一个。\n');

  const all = browserCandidates();
  const exists = all.filter((p) => { try { return p && fs.existsSync(p); } catch { return false; } });
  console.error(exists.length ? '已找到但不完整：' : '查过这些位置（都不存在）：');
  (exists.length ? exists : all).slice(0, 12).forEach((p) => console.error('  ' + p));

  console.error('\n请装一个浏览器（任意一个即可）：');
  if (isWin) {
    console.error('  Edge   : Windows 10/11 自带。如果被卸载了，从 https://www.microsoft.com/edge 装回来');
    console.error('  Chrome : https://www.google.com/chrome/  或  winget install Google.Chrome');
  } else if (isMac) {
    console.error('  Chrome : https://www.google.com/chrome/  或  brew install --cask google-chrome');
    console.error('  Edge   : https://www.microsoft.com/edge');
  } else {
    console.error('  Debian/Ubuntu : sudo apt install chromium');
    console.error('  Fedora        : sudo dnf install chromium');
    console.error('  Arch          : sudo pacman -S chromium');
  }

  console.error('\n装好后回来重跑本命令即可。');
  console.error('\n如果已经装了，但不在上面的列表里（绿色版、自定义目录等），直接指定路径：');
  if (isWin) console.error('  set DSH_BROWSER=D:\\path\\to\\chrome.exe');
  else console.error('  export DSH_BROWSER=/path/to/chrome');
  console.error('然后再跑一次。');
}

console.log(`平台      : ${platformLabel()}`);
console.log(`工具链    : ${TOOLKIT}`);
console.log(`profile   : ${PROFILE}   （登录态存在这里，别复制给别人）`);

// 已在运行就直接复用
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  const v = await r.json();
  console.log(`\n端口 ${PORT} 已在监听，复用现有窗口: ${v.Browser}`);
  console.log('如果窗口没开着，先把它关掉再重跑本脚本。');
  process.exit(0);
} catch { /* 没在跑，继续启动 */ }

const browser = findBrowser();
if (!browser) {
  printBrowserHelp();
  process.exit(1);
}

const kind = browserKind(browser);
fs.mkdirSync(PROFILE, { recursive: true });
console.log(`浏览器    : ${browser}  [${kind === 'edge' ? 'Edge（Chromium 系没找到，用 Edge 兜底）' : 'Chromium 系'}]`);
console.log(`\n启动中…`);

const child = spawn(browser, browserArgs({ port: PORT, profileDir: PROFILE, url: URL_ARG }), {
  detached: true,
  stdio: 'ignore',
  // 关键：把选中的浏览器告诉工具链的后续脚本，
  // 否则它们会各自再猜一次路径，可能猜到别的浏览器上（甚至猜不到）。
  env: { ...process.env, DSH_BROWSER: browser },
});
child.unref();

// 等端口就绪
let ready = false;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const v = await r.json();
    console.log(`就绪      : ${v.Browser}`);
    console.log(`UA        : ${v['User-Agent']}`);
    ready = true;
    break;
  } catch { /* 再等 */ }
}

if (!ready) {
  console.error(`\n端口 ${PORT} 20 秒内没就绪。可能浏览器启动失败，或安全软件拦了。`);
  console.error('可以试试手动起一个带调试端口的浏览器：');
  console.error(`  "${browser}" --remote-debugging-port=${PORT} --user-data-dir="${PROFILE}"`);
  process.exit(1);
}

console.log('\n========================================');
console.log('  请在弹出的浏览器窗口里扫码登录抖音');
console.log('  （建议用小号；登录态会保留，下次不用再扫）');
console.log('  登录并看到内容后，就可以去跑采集了。');
console.log('========================================');
console.log('\n窗口会一直开着；采集跑完 run.mjs 会自动关掉它。');
console.log('想手动关：直接关窗口，或跑  node scripts/close-browser.mjs');
