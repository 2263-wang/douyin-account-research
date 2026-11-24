// 编排器：把 dsh-browser 工具链串成三个模式的流水线，然后交给分析引擎出报告
//
// 用法:
//   node run.mjs --mode topic    --keyword "AI编程"
//   node run.mjs --mode account  --account <secUid | 主页URL | 昵称>   [--days 30]
//   node run.mjs --mode comments --works works-xxx.json [--days 30]
//   node run.mjs --analyze-only --inputs <目录或文件...> --mode account --report 报告.md
//
// 常用开关:
//   --days N           只保留最近 N 天的作品（account/comments 模式；默认 30）
//   --since YYYY-MM-DD 指定起始日期（优先于 --days）
//   --toolkit <目录>   工具链目录（默认 $DSH_TOOLKIT 或工作区 dsh-browser）
//   --with-history     额外把工具链目录里的历史产物也纳入分析（默认不吃，避免串数据）
//   --keep-browser     跑完不关浏览器（默认跑完关闭）
//   --dry / --only / --skip
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arg } from './lib/cdp.mjs';
import { emptyState, adaptPaths } from './lib/adapt.mjs';
import { closeBrowserByProfile, profileDirFor, findBrowser } from './lib/browser.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(HERE);          // scripts/ 的上一级 = skill 根目录
const argv = process.argv.slice(2);
const MODE = arg(argv, 'mode', '');
const KEYWORD = arg(argv, 'keyword', '');
const ACCOUNT = arg(argv, 'account', '');
const WORKS_IN = arg(argv, 'works', '');
const MAX_SCROLLS = arg(argv, 'maxScrolls', '');
const REPORT = arg(argv, 'report', '');
const DAYS = Number(arg(argv, 'days', '30'));
const SINCE = arg(argv, 'since', '');
const INPUTS = argv.reduce((acc, a, i) => (a === '--inputs' ? argv.slice(i + 1).filter((x) => !x.startsWith('--')) : acc), []);
const ONLY = arg(argv, 'only', '').split(',').filter(Boolean);
const SKIP = arg(argv, 'skip', '').split(',').filter(Boolean);
const DRY = argv.includes('--dry');
const ANALYZE_ONLY = argv.includes('--analyze-only');
const WITH_HISTORY = argv.includes('--with-history');
const KEEP_BROWSER = argv.includes('--keep-browser');

// 工具链位置解析顺序（可移植性关键）：
//   1) --toolkit <目录>
//   2) 环境变量 DSH_TOOLKIT
//   3) skill 目录下的 toolkit/（分发包自带的形态）
//   4) 环境变量 DSH_BROWSER_LEGACY（旧机器上的位置，可选）
//   5) 当前工作目录下的 dsh-browser / toolkit
function findToolkit() {
  return resolveToolkit({
    explicit: arg(argv, 'toolkit', '') || process.env.DSH_TOOLKIT || '',
    skillRoot: SKILL,
  });
}
const TOOLKIT = findToolkit();
const RUN_DIR = path.resolve(arg(argv, 'outdir', `douyin-runs/${MODE || 'analyze'}-${new Date().toISOString().slice(0, 10)}`));
const LOG = path.join(RUN_DIR, 'run.log');
fs.mkdirSync(RUN_DIR, { recursive: true });

const cutoff = SINCE || new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);

// ---------- 步骤定义 ----------
const steps = [];
const step = (name, args, opts = {}) => steps.push({ name, args, opts });

function plan() {
  if (MODE === 'topic') {
    if (!KEYWORD) throw new Error('topic 模式需要 --keyword');
    step('search', ['crawl.js', 'search', KEYWORD]);
    step('merge', ['merge-search.js']);
    step('candidates', ['candidates.js']);
    step('rank', ['rank.js', 'candidates.json']);
    step('works', ['batch-works.js', 'candidates.json']);
    step('engagement', ['engagement.js']);
    step('comments', ['comments.js', '', '', MAX_SCROLLS || '6']);
  } else if (MODE === 'account') {
    if (!ACCOUNT) throw new Error('account 模式需要 --account');
    step('works', ['works.js', '{SECUID}', path.join(RUN_DIR, 'works.json'), MAX_SCROLLS || '14']);
    step('dates', ['dates.js', '{SECUID}', path.join(RUN_DIR, 'dates.json')]);
    // vstats / comments 在日期解析之后，只跑时间窗内的作品
    step('vstats', ['vstats.js', path.join(RUN_DIR, 'works-window.json'), path.join(RUN_DIR, 'vstats.json')], { afterWindow: true });
    step('comments', ['comments.js', path.join(RUN_DIR, 'works-window.json'), path.join(RUN_DIR, 'comments.json'), MAX_SCROLLS || '6'], { afterWindow: true });
  } else if (MODE === 'comments') {
    if (!WORKS_IN) throw new Error('comments 模式需要 --works <works.json>');
    step('comments', ['comments.js', WORKS_IN, path.join(RUN_DIR, 'comments.json'), MAX_SCROLLS || '6']);
  }
  return steps.filter((s) => (!ONLY.length || ONLY.includes(s.name)) && !SKIP.includes(s.name));
}

// ---------- 账号解析 ----------
function resolveAccount() {
  if (/^https?:\/\//.test(ACCOUNT)) {
    const m = ACCOUNT.match(/\/user\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
  }
  if (/^MS4wLjABAAAA[A-Za-z0-9_-]+$/.test(ACCOUNT)) return ACCOUNT;   // 已经是 secUid

  console.log(`[resolve] "${ACCOUNT}" 不是 secUid，走搜索解析…`);
  if (DRY) return '{SECUID}';
  try {
    const out = execFileSync('node', [path.join(HERE, 'resolve-account.mjs'), '--name', ACCOUNT,
      '--out', path.join(RUN_DIR, 'account.json')], { cwd: TOOLKIT, encoding: 'utf8', timeout: 120000 });
    fs.appendFileSync(LOG, `\n===== resolve =====\n${out}\n`, 'utf8');
    const m = out.match(/SECUID=([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('解析输出里没有 SECUID');
    console.log(`[resolve] -> ${m[1]}`);
    return m[1];
  } catch (e) {
    const err = (e.stderr || '') + (e.stdout || '') + (e.message || '');
    console.log('[resolve] 失败：\n' + err.split('\n').filter(Boolean).slice(-8).map((l) => '   ' + l).join('\n'));
    throw new Error(`无法把 "${ACCOUNT}" 解析成 secUid。可以直接传 secUid 或主页 URL。`);
  }
}

// ---------- 时间窗过滤 ----------
/** 用 dates.js 的结果过滤 works.json，只留窗口内的作品 */
function applyWindow() {
  const worksPath = path.join(RUN_DIR, 'works.json');
  const datesPath = path.join(RUN_DIR, 'dates.json');
  const outPath = path.join(RUN_DIR, 'works-window.json');
  if (!fs.existsSync(worksPath)) { console.log('[window] 没有 works.json，跳过'); return null; }
  const works = JSON.parse(fs.readFileSync(worksPath, 'utf8'));

  // 日期来源：只认本次运行产出的 dates.json（按 id 对齐）。
  // 绝不读工具链目录里的历史文件——那会把别的账号的日期灌进本次结果。
  const dateById = new Map();
  if (fs.existsSync(datesPath)) {
    const d = JSON.parse(fs.readFileSync(datesPath, 'utf8'));
    for (const r of d.results || d.scored || []) {
      const abs = String(r.abs || r.published || '').slice(0, 10);
      if (r.id && abs) dateById.set(String(r.id), abs);
    }
  }
  if (dateById.size === 0) {
    console.log('[window] dates.json 没有可用日期，改用作品 id 内嵌时间戳推算');
  }
  // 抖音 id 高位含时间戳，可作为兜底
  const idToDate = (id) => {
    try {
      const t = Number(BigInt(id) >> 32n);
      const d = new Date(t * 1000);
      return d.getFullYear() > 2016 && d.getFullYear() < 2100 ? d.toISOString().slice(0, 10) : null;
    } catch { return null; }
  };

  const items = (works.items || []).map((it) => {
    const date = dateById.get(String(it.id)) || idToDate(it.id) || null;
    return { ...it, date };
  });
  const inWindow = items.filter((it) => it.date && it.date >= cutoff);
  const undated = items.filter((it) => !it.date);

  works.items = inWindow;
  works.count = inWindow.length;
  works.window = { since: cutoff, totalBeforeWindow: items.length, undated: undated.length };
  fs.writeFileSync(outPath, JSON.stringify(works, null, 2), 'utf8');

  console.log(`[window] 截止 ${cutoff}：${items.length} 条 -> ${inWindow.length} 条在窗口内` +
    (undated.length ? `（${undated.length} 条无法确定日期，已排除）` : ''));
  if (inWindow.length) {
    const dates = inWindow.map((i) => i.date).sort();
    console.log(`[window] 窗口内日期范围: ${dates[0]} ~ ${dates[dates.length - 1]}`);
  }
  return outPath;
}

// ---------- 执行 ----------
function runStep(s, ctx) {
  const args = s.args.map((a) => (a === '{SECUID}' ? ctx.secUid : a));
  const printable = `node ${args.filter(Boolean).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  console.log(`\n▶ [${s.name}] ${printable}`);
  // 统一浏览器选择：把我们探测到的浏览器传给工具链，避免它各脚本再猜一次
  // （它可能猜到别的浏览器，或一个都猜不到）
  const env = { ...process.env, DSH_BROWSER_PORT: process.env.DSH_BROWSER_PORT || '9222' };
  if (!env.DSH_BROWSER) {
    const b = findBrowser();
    if (b) env.DSH_BROWSER = b;
  }
  try {
    const out = execFileSync('node', args.filter((a) => a !== ''), {
      cwd: TOOLKIT, env,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
    });
    fs.appendFileSync(LOG, `\n===== ${s.name} =====\n${out}\n`, 'utf8');
    out.split('\n').filter(Boolean).slice(-5).forEach((l) => console.log('   ' + l));
    return true;
  } catch (e) {
    const err = (e.stderr || '') + (e.stdout || '') + (e.message || '');
    fs.appendFileSync(LOG, `\n===== ${s.name} FAILED =====\n${err}\n`, 'utf8');
    console.log('   ✗ 失败:');
    err.split('\n').filter(Boolean).slice(-6).forEach((l) => console.log('     ' + l));
    return false;
  }
}

// ---------- 分析 ----------
const TOOLKIT_GLOBS = {
  topic: [/^clicksearch-.*\.json$/, /^search-merged\.json$/],
  account: [],
  comments: [],
};

function analyze() {
  const inputs = [...INPUTS];
  if (!ANALYZE_ONLY) {
    // 本次运行自己产出的全部文件（works / works-window / dates / vstats / comments）
    if (fs.existsSync(RUN_DIR)) {
      for (const f of fs.readdirSync(RUN_DIR)) {
        if (f.endsWith('.json') && f !== 'normalized.json') inputs.push(path.join(RUN_DIR, f));
      }
    }
    const globs = WITH_HISTORY ? (TOOLKIT_GLOBS[MODE] || []) : [];
    if (TOOLKIT && globs.length) {
      for (const f of fs.readdirSync(TOOLKIT)) if (globs.some((re) => re.test(f))) inputs.push(path.join(TOOLKIT, f));
    }
  }
  const existing = inputs.filter((p) => fs.existsSync(p));
  if (!existing.length) {
    console.error('\n没有可分析的输入文件。多半是前面的采集步骤失败了，看 run.log。');
    process.exit(1);
  }
  const state = emptyState();
  const { files, shapes } = adaptPaths(state, existing);
  fs.writeFileSync(path.join(RUN_DIR, 'normalized.json'), JSON.stringify(state, null, 2), 'utf8');

  console.log(`\n[normalize] 输入文件 ${files} 个  形状: ${JSON.stringify(shapes)}`);
  console.log(`[normalize] videos=${state.videos.length} comments=${state.comments.length} authors=${state.authors.length}`);
  if (state.videos.length === 0) {
    console.log('[normalize] ⚠ 没解析出任何视频。检查前面的采集步骤是否真的拿到了数据（看 run.log）。');
  }

  const report = REPORT || path.join(RUN_DIR, `report-${MODE || 'analyze'}.md`);
  execFileSync('node', [path.join(HERE, 'analyze.mjs'), '--mode', MODE || 'topic',
    '--data', path.join(RUN_DIR, 'normalized.json'),
    '--transcripts', path.resolve(arg(argv, 'transcripts', 'data/transcripts')),
    '--report', report], { stdio: 'inherit' });
  console.log(`\n[report] ${report}`);
}

/** 关闭本工具链启动的浏览器（只按 profile 路径匹配，不碰用户自己的浏览器） */
function closeBrowser() {
  if (KEEP_BROWSER || DRY || ANALYZE_ONLY) {
    if (KEEP_BROWSER) console.log('\n[cleanup] --keep-browser：保留浏览器不关。');
    return;
  }
  const profileDir = profileDirFor(TOOLKIT || process.cwd());
  console.log('\n[cleanup] 关闭本工具链的浏览器…');
  const r = closeBrowserByProfile(profileDir);
  if (r.error) console.log('   关闭失败（可手动关）:', r.error);
  else if (r.closed) console.log(`   已关闭 ${r.closed} 个进程`);
  else console.log('   没有本工具链的浏览器在跑');
}

// ---------- main ----------
if (!TOOLKIT && !ANALYZE_ONLY) {
  console.error('找不到工具链（需要含 launch.ps1 的目录）。用 --toolkit 指定或设 DSH_TOOLKIT。');
  process.exit(1);
}
console.log(`工具链: ${TOOLKIT || '(仅分析)'}`);
console.log(`输出目录: ${RUN_DIR}`);
console.log(`时间窗: ${cutoff} 起（${SINCE ? '--since' : `--days ${DAYS}`}）`);

try {
  const planned = ANALYZE_ONLY ? [] : plan();
  const ctx = { secUid: null };

  if (planned.length) {
    console.log(`\n计划执行 ${planned.length} 步: ${planned.map((s) => s.name).join(' -> ')}`);
    if (DRY) {
      if (MODE === 'account') ctx.secUid = resolveAccount();
      planned.forEach((s) => console.log(`\n▶ [${s.name}] node ${s.args.map((a) => (a === '{SECUID}' ? ctx.secUid : a)).filter(Boolean).join(' ')}`));
      console.log('\n（--dry：未执行任何命令）');
      process.exit(0);
    }

    if (MODE === 'account') ctx.secUid = resolveAccount();

    const windowSteps = planned.filter((s) => s.opts.afterWindow);
    for (const s of planned.filter((x) => !x.opts.afterWindow)) runStep(s, ctx);
    if (MODE === 'account') {
      applyWindow();
      for (const s of windowSteps) runStep(s, ctx);
    }
  }
  analyze();
} finally {
  closeBrowser();
}
