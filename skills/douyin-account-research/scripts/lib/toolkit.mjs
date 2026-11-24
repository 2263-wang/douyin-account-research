// 工具链（dsh-browser）定位。三处脚本共用，避免逻辑分叉。
//
// 解析顺序：
//   1) --toolkit <目录> 参数（若传了 argv 与参数名）
//   2) 环境变量 DSH_TOOLKIT
//   3) skill 目录下的 toolkit/            ← 分发包自带形态
//   4) 从当前工作目录向上逐级找 dsh-browser / toolkit   ← 开发机 / 用户自定义目录
//   5) 环境变量 DSH_BROWSER_LEGACY（历史位置兜底）
import fs from 'node:fs';
import path from 'node:path';

const MARKERS = ['launch.ps1', 'launch.sh', 'comments.js', 'crawl.js'];

const looksLikeToolkit = (dir) => {
  try { return MARKERS.some((f) => fs.existsSync(path.join(dir, f))); } catch { return false; }
};

/** 从 startDir 向上最多 5 级，查找名为 name 的工具链目录 */
function searchUp(startDir, name, maxLevels = 5) {
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxLevels; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate) && looksLikeToolkit(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} [opts.explicit]  显式路径（来自 --toolkit）
 * @param {string} [opts.skillRoot] skill 根目录（其下找 toolkit/）
 * @returns {string|null}
 */
export function resolveToolkit({ explicit = '', skillRoot = '' } = {}) {
  if (explicit) {
    const p = path.resolve(explicit);
    return looksLikeToolkit(p) ? p : p;   // 显式指定就信任，即使标记文件不全
  }
  if (process.env.DSH_TOOLKIT) {
    const p = path.resolve(process.env.DSH_TOOLKIT);
    if (fs.existsSync(p)) return p;
  }
  if (skillRoot) {
    const p = path.join(skillRoot, 'toolkit');
    if (looksLikeToolkit(p)) return p;
    const p2 = path.join(path.dirname(skillRoot), 'toolkit');
    if (looksLikeToolkit(p2)) return p2;
  }
  for (const name of ['dsh-browser', 'toolkit']) {
    const p = searchUp(process.cwd(), name);
    if (p) return p;
  }
  if (process.env.DSH_BROWSER_LEGACY) {
    const p = path.resolve(process.env.DSH_BROWSER_LEGACY);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 该工具链的 profile（登录态）目录 */
export const toolkitProfile = (toolkitDir) => path.join(toolkitDir, 'profile');
