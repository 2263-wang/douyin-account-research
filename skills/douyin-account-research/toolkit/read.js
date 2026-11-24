// dsh-browser-read.js — 读取已渲染的 DOM 快照，提取账号资料 / 作品列表
// 用法:
//   node read.js profile <dump.html>   → 账号资料
//   node read.js videos  <dump.html>   → 作品列表
import { readFileSync } from 'node:fs';

const [, , mode = 'profile', file = 'dump.html'] = process.argv;

const html = readFileSync(file, 'utf8');
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const isLoginWall = /扫码登录|验证码登录|captcha|登录后查看/.test(html);

if (mode === 'profile') {
  const nick = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
  const uniq = [...new Set(text)];
  const statIdx = uniq.findIndex((l) => /粉丝/.test(l));
  const win = statIdx >= 0 ? uniq.slice(Math.max(0, statIdx - 8), statIdx + 14) : [];
  console.log('file        :', file, `(${html.length} chars)`);
  console.log('login wall  :', isLoginWall ? 'YES —— 尚未登录' : 'no');
  console.log('title       :', nick.trim() || '(空)');
  console.log('signals     :', {
    汉字数量: (html.match(/[\u4e00-\u9fa5]/g) || []).length,
    粉丝字样: (html.match(/粉丝/g) || []).length,
    简介字样: (html.match(/介绍前沿有趣/g) || []).length,
    user链接: (html.match(/\/user\//g) || []).length,
  });
  console.log('--- 资料区附近文本 ---');
  console.log(win.length ? win.join(' | ') : '(未找到)');
} else if (mode === 'videos') {
  const ids = [...new Set([...html.matchAll(/\/video\/(\d{15,25})/g)].map((m) => m[1]))];
  const items = [];
  for (const id of ids) {
    const at = html.indexOf(`/video/${id}`);
    const near = html
      .slice(Math.max(0, at - 3000), at + 3000)
      .replace(/<[^>]+>/g, '\n')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.length < 220);
    items.push({ id, nearby: near.slice(0, 24) });
  }
  console.log('file        :', file);
  console.log('login wall  :', isLoginWall ? 'YES —— 尚未登录' : 'no');
  console.log('作品数      :', ids.length);
  items.forEach((it, i) => {
    console.log(`\n[${i + 1}] video/${it.id}`);
    console.log('   ', it.nearby.slice(0, 14).join(' ｜ '));
  });
}
