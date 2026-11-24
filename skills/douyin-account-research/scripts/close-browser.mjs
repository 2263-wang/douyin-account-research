// 关闭本工具链启动的浏览器（跨平台）
// 用法: node scripts/close-browser.mjs [--toolkit <目录>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from './lib/cdp.mjs';
import { closeBrowserByProfile, profileDirFor } from './lib/browser.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);

const TOOLKIT = resolveToolkit({
  explicit: arg(argv, 'toolkit', '') || process.env.DSH_TOOLKIT || '',
  skillRoot: SKILL_ROOT,
}) || path.join(SKILL_ROOT, 'toolkit');
const PROFILE = profileDirFor(TOOLKIT);

console.log(`按 profile 匹配关闭: ${PROFILE}`);
const r = closeBrowserByProfile(PROFILE);

if (r.error) {
  console.log('关闭失败（可手动关窗口）:', r.error);
  process.exit(1);
}
console.log(r.closed ? `已关闭 ${r.closed} 个进程` : '没有本工具链的浏览器在跑');
