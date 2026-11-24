// 解析工具链的输出 -> data/normalized.json（供 analyze.mjs 使用）
//
// 支持的输入形状见 lib/adapt.mjs 顶部注释。可以传目录，也可以传具体文件。
// 用法: node normalize.mjs [--in <目录或文件> ...] [--out data/normalized.json]
//   不传 --in 时，自动扫描 --toolkit（默认 ../dsh-browser）里的产物
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, ensureDir, writeJson } from './lib/cdp.mjs';
import { emptyState, adaptPaths } from './lib/adapt.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const argv = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(HERE);
const OUT = path.resolve(arg(argv, 'out', 'data/normalized.json'));

// 收集输入
let inputs = argv.reduce((acc, a, i) => (a === '--in' ? [...acc, ...argv.slice(i + 1).filter((x) => !x.startsWith('--'))] : acc), []);
const TOOLKIT = resolveToolkit({ explicit: arg(argv, 'toolkit', '') || process.env.DSH_TOOLKIT || '', skillRoot: SKILL_ROOT });

if (!inputs.length) {
  if (!fs.existsSync(TOOLKIT)) {
    console.error(`需要 --in <目录或文件>，或一个存在的 --toolkit 目录。当前 toolkit=${TOOLKIT}`);
    process.exit(1);
  }
  for (const f of fs.readdirSync(TOOLKIT)) {
    if (/^(clicksearch-.*|search-merged|comments-.*|vstats-.*|works-.*|engagement|authors|candidates)\.json$/.test(f)) {
      inputs.push(path.join(TOOLKIT, f));
    }
  }
  console.log(`自动扫描 ${TOOLKIT} -> ${inputs.length} 个文件`);
}

const state = emptyState();
const { files, shapes } = adaptPaths(state, inputs);

ensureDir(path.dirname(OUT));
writeJson(OUT, state);

console.log(`[normalize] files=${files} videos=${state.videos.length} comments=${state.comments.length} authors=${state.authors.length}`);
console.log(`[normalize] 形状分布: ${JSON.stringify(shapes)}`);
console.log(`[normalize] out=${OUT}`);
if (state.sources.length) {
  console.log('[normalize] 输入明细:');
  state.sources.slice(0, 20).forEach((s) => console.log(`   ${s.shape.padEnd(14)} ${s.file}`));
}
const unknown = state.sources.filter((s) => s.shape === 'unknown');
if (unknown.length) console.log(`[normalize] 警告: ${unknown.length} 个文件形状未识别（可能不是工具链产物）`);
