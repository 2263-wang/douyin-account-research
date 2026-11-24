// 账号解析：把昵称（或主页链接）解析成 secUid / 主页 URL
// 用法: node resolve-account.mjs --name "某账号昵称"
//       node resolve-account.mjs --url "https://www.douyin.com/user/MS4w..."
//
// 背景：工具链的 works.js / dates.js 只认 secUid，传昵称会静默返回 0 条。
//       抖音搜索的"用户"tab 是 DOM 是渲染出来的，所以这里走无接口的 DOM 提取。
import fs from 'node:fs';
import path from 'node:path';
import { arg, pickPage, connect, sleep, writeJson } from './lib/cdp.mjs';

const argv = process.argv.slice(2);
const PORT = Number(arg(argv, 'port', '9222'));
const NAME = arg(argv, 'name', '');
const URL_IN = arg(argv, 'url', '');
const OUT = arg(argv, 'out', '');
const MAX = Number(arg(argv, 'max', '12'));

if (!NAME && !URL_IN) { console.error('需要 --name 或 --url'); process.exit(1); }

let secUid = null;
let profileUrl = URL_IN;

if (URL_IN) {
  const m = URL_IN.match(/\/user\/([A-Za-z0-9_-]+)/);
  if (m) secUid = m[1];
}

if (!secUid && NAME) {
  const page = await pickPage(PORT);
  const { ws, send } = await connect(page);
  await send('Page.enable');

  const kw = encodeURIComponent(NAME.replace(/^@/, ''));
  await send('Page.navigate', { url: `https://www.douyin.com/search/${kw}?type=user` });
  await sleep(7000);

  const EXPR = `(() => {
    const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/user/"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\\/user\\/([A-Za-z0-9_-]+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const box = a.closest('li,div') || a;
      out.push({ secUid: m[1], href: 'https://www.douyin.com/user/' + m[1], text: txt(box.innerText).slice(0, 120) });
    }
    return { url: location.href, count: out.length, rows: out };
  })()`;

  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
  const data = r.result?.value || { rows: [] };
  ws.close();

  const target = NAME.replace(/^@/, '').trim();
  const rows = data.rows || [];
  // 优先匹配 text 里出现昵称的那一行
  const hit = rows.find((x) => x.text.includes(target)) || rows[0];
  if (hit) { secUid = hit.secUid; profileUrl = hit.href; }

  console.log(`搜索 "${NAME}" -> 命中 ${rows.length} 个候选账号`);
  rows.slice(0, MAX).forEach((x, i) => {
    const mark = x.secUid === secUid ? ' <== 选中' : '';
    console.log(`  [${i + 1}] ${x.secUid.slice(0, 24)}…  ${x.text.slice(0, 60)}${mark}`);
  });
}

if (!secUid) { console.error('未能解析出 secUid'); process.exit(1); }

const result = { name: NAME || null, secUid, profileUrl: `https://www.douyin.com/user/${secUid}`, at: new Date().toISOString() };
console.log(`\nsecUid: ${secUid}`);
if (OUT) { writeJson(path.resolve(OUT), result); console.log(`-> ${OUT}`); }
// 便于 shell 捕获
console.log(`SECUID=${secUid}`);
