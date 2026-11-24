// 解析抖音分享短链 -> 真实链接 / 视频 id / 作者
// 用法: node scripts/resolve-share.mjs --url "https://v.douyin.com/xxxx/" [--keep-browser]
//
// 短链在浏览器外会被 302 到验证页，所以必须在已登录的浏览器里打开。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, pickPage, connect, sleep, writeJson } from './lib/cdp.mjs';
import { ensureBrowser, registerCleanup, wantsKeepBrowser } from './lib/browser-lifecycle.mjs';
import { resolveToolkit } from './lib/toolkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PORT = Number(arg(argv, 'port', '9222'));
const URL_ARG = arg(argv, 'url', '');
const OUT = arg(argv, 'out', '');

if (!URL_ARG) { console.error('需要 --url <分享链接>'); process.exit(1); }

// 生命周期自管：跑完自动关，不在桌面留窗口（除非 --keep-browser）
const SKILL_ROOT = path.dirname(HERE);
const TOOLKIT = resolveToolkit({ explicit: arg(argv, 'toolkit', '') || process.env.DSH_TOOLKIT || '', skillRoot: SKILL_ROOT });
registerCleanup({ keep: wantsKeepBrowser(argv), toolkit: TOOLKIT });
try {
  await ensureBrowser({ port: PORT });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const page = await pickPage(PORT);
const { ws, send } = await connect(page);
await send('Page.enable');

console.log(`打开: ${URL_ARG}`);
await send('Page.navigate', { url: URL_ARG });
await sleep(9000);

// 等页面稳定 + 读取
const EXPR = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const body = txt(document.body.innerText);
  const href = location.href;
  const vm = href.match(/\\/video\\/(\\d+)/);
  // 优先从"作者"链接拿 secUid
  const userA = document.querySelector('a[href*="/user/"]');
  const um = userA ? (userA.getAttribute('href') || '').match(/\\/user\\/([A-Za-z0-9_-]+)/) : null;
  return {
    url: href,
    videoId: vm ? vm[1] : null,
    userHref: userA ? userA.getAttribute('href') : null,
    secUid: um ? um[1] : null,
    title: document.title,
    bodyHead: body.slice(0, 400),
  };
})()`;

const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
const info = r.result?.value || {};
ws.close();

console.log('\n=== 解析结果 ===');
console.log('最终链接 :', info.url);
console.log('页面标题 :', info.title);
console.log('视频 id  :', info.videoId || '(未识别)');
console.log('作者 secUid:', info.secUid || '(未识别——可能要等页面渲染)');
console.log('正文开头 :', (info.bodyHead || '').slice(0, 160));

if (OUT) { writeJson(path.resolve(OUT), info); console.log(`\n-> ${OUT}`); }
