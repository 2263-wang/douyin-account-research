// 跨平台环境自检（Windows / macOS / Linux）
// 用法: node scripts/verify-env.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findBrowser, browserKind, browserCandidates, platformLabel } from './lib/browser.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(HERE);

let ok = 0, bad = 0;
const check = (name, cond, hint) => {
  if (cond) { console.log(`  [OK]   ${name}`); ok++; }
  else { console.log(`  [MISS] ${name}   -> ${hint}`); bad++; }
};
const has = (cmd) => {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; }
  catch { return false; }
};
const pyHas = (mod) => {
  try { execFileSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' }); return true; }
  catch {
    try { execFileSync('python', ['-c', `import ${mod}`], { stdio: 'ignore' }); return true; }
    catch { return false; }
  }
};

console.log(`\n平台: ${platformLabel()}\n`);

console.log('=== 必需 ===');
const nodeMajor = Number(process.versions.node.split('.')[0]);
check(`Node.js >= 18`, nodeMajor >= 18, `当前 ${process.versions.node}，去 https://nodejs.org 升级`);
const browser = findBrowser();
check('浏览器（Chromium 系优先，其次 Edge）', !!browser, '装一个 Chrome 或 Edge；或设 DSH_BROWSER 指定路径');
if (browser) {
  const kind = browserKind(browser);
  console.log(`         使用: ${browser}${kind === 'edge' ? '  [Edge 兜底]' : '  [Chromium 系]'}`);
} else {
  console.log('         查找顺序: 先 Chromium 系（Chrome/Chromium/Brave/Vivaldi/Opera），再 Edge');
  console.log('         查过这些位置:');
  browserCandidates().slice(0, 10).forEach((p) => console.log('           ' + p));
}
const toolkitDir = resolveToolkit({ explicit: process.env.DSH_TOOLKIT || '', skillRoot: SKILL_ROOT });
check('toolkit/ 可用', !!toolkitDir, '包不完整，重新解压；或用 DSH_TOOLKIT 指定目录');
if (toolkitDir) console.log(`         位置: ${toolkitDir}`);

console.log('\n=== 转写功能需要（不用逐字稿可忽略） ===');
check('ffmpeg', has('ffmpeg'), process.platform === 'darwin' ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg');
check('ffprobe', has('ffprobe'), '随 ffmpeg 一起装');
const hasPy = has('python3') || has('python');
check('Python 3', hasPy, 'https://python.org');
if (hasPy) {
  check('python: faster-whisper', pyHas('faster_whisper'), 'pip install faster-whisper');
  check('python: opencc', pyHas('opencc'), 'pip install opencc-python-reimplemented');
}

console.log('\n=== 说明 ===');
console.log('  * 全部脚本只用 Node 内置能力，不需要 npm install');
console.log('  * 采集必须用可见浏览器 + 人工扫码登录（headless 会被判为自动化客户端）');

console.log(`\n=== 结果 ===\n  通过 ${ok} 项，缺失 ${bad} 项`);
if (bad > 0) {
  console.log('  缺失项不影响采集，只影响对应功能；按提示装即可。');
  process.exit(1);
}
console.log('  环境完备。');
process.exit(0);
