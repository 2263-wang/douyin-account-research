// 取详情：在页面里同源 fetch 详情接口 -> data/detail/<id>.json
// 用法: node fetch-detail.mjs --ids 123,456   [--port 9222] [--keep-browser]
//   或: node fetch-detail.mjs --from data/normalized.json --top 10
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, pickPage, connect, sleep, ensureDir, writeJson } from './lib/cdp.mjs';
import { ensureBrowser, registerCleanup, wantsKeepBrowser } from './lib/browser-lifecycle.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const argv = process.argv.slice(2);
const PORT = Number(arg(argv, 'port', '9222'));
const OUT = path.resolve(arg(argv, 'out', 'data/detail'));
let IDS = arg(argv, 'ids', '').split(',').map((s) => s.trim()).filter(Boolean);
const FROM = arg(argv, 'from', '');
const TOP = Number(arg(argv, 'top', '10'));
const DELAY = Number(arg(argv, 'delay', '1200')); // 每个之间停顿，人类速度

// 生命周期自管：没起就自动起，跑完自动关（除非 --keep-browser）。
// 根因：之前 run.mjs 会自己关浏览器，但这些独立脚本不会，于是跑完就留个窗口在桌面上。
const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOOLKIT = resolveToolkit({ explicit: arg(argv, 'toolkit', '') || process.env.DSH_TOOLKIT || '', skillRoot: SKILL_ROOT });
registerCleanup({ keep: wantsKeepBrowser(argv), toolkit: TOOLKIT });
try {
  await ensureBrowser({ port: PORT });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (FROM) {
  const norm = JSON.parse(fs.readFileSync(path.resolve(FROM), 'utf8'));
  IDS = norm.videos.slice(0, TOP).map((v) => v.awemeId);
}
if (!IDS.length) { console.error('需要 --ids 或 --from'); process.exit(1); }

ensureDir(OUT);
const page = await pickPage(PORT);
console.log(`[detail] page=${page.url.slice(0, 100)}  ids=${IDS.length}`);

const { ws, send } = await connect(page);
const summary = [];

for (const id of IDS) {
  const expr = `(async () => {
    const u = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}'
      + '&device_platform=webapp&aid=6383&channel=channel_pc_web&pc_client_type=1'
      + '&version_code=190500&version_name=19.5.0&cookie_enabled=true&platform=PC'
      + '&browser_language=zh-CN&browser_platform=Win32&browser_name=Edge&browser_version=155.0.0.0';
    try { const r = await fetch(u, { credentials: 'include' }); const t = await r.text();
          return JSON.stringify({ ok: r.ok, status: r.status, len: t.length, body: t }); }
    catch (e) { return JSON.stringify({ error: String(e) }); }
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, 45000);
  const raw = res.result?.value;
  if (!raw) { console.log(`  ${id}: 无返回`); continue; }
  let outer; try { outer = JSON.parse(raw); } catch { console.log(`  ${id}: 外层解析失败`); continue; }
  if (outer.error) { console.log(`  ${id}: ${outer.error}`); continue; }

  fs.writeFileSync(path.join(OUT, `${id}.json`), outer.body, 'utf8');
  let j = null; try { j = JSON.parse(outer.body); } catch {}
  const a = j?.aweme_detail;
  if (!a) { console.log(`  ${id}: HTTP ${outer.status} 无 aweme_detail（可能触发验证）`); continue; }

  const v = a.video || {};
  const gears = (v.bit_rate || []).filter((g) => g.play_addr?.url_list?.length);
  summary.push({
    awemeId: id,
    desc: (a.desc || '').replace(/\s+/g, ' ').slice(0, 80),
    author: a.author?.nickname || '',
    durationSec: v.duration ? Math.round(v.duration / 1000) : null,
    digg: a.statistics?.digg_count ?? null,
    comment: a.statistics?.comment_count ?? null,
    collect: a.statistics?.collect_count ?? null,
    gears: gears.length,
    hasAudioTrack: !!(v.bit_rate_audio && v.bit_rate_audio.length),
  });
  console.log(`  ${id}: HTTP ${outer.status}  gears=${gears.length}  dur=${summary.at(-1).durationSec}s`);
  await sleep(DELAY);
}

writeJson(path.join(path.dirname(OUT), 'detail-summary.json'), summary);
console.log(`[detail] done=${summary.length}  -> ${path.join(path.dirname(OUT), 'detail-summary.json')}`);
ws.close();
