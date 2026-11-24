// vstats.js — visit each video page and extract publish date + real engagement.
//   node vstats.js <works.json> [outFile]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inFile = process.argv[2] || join(HERE, 'works.json');
const outFile = process.argv[3] || join(HERE, 'vstats.json');

let n = 0;
class S {
  constructor(ws) { this.ws = ws; this.pending = new Map(); }
  static async open(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    const s = new S(ws);
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.id != null && s.pending.has(m.id)) {
        const p = s.pending.get(m.id); s.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    return s;
  }
  send(m, p = {}) {
    const id = ++n;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('timeout ' + m)); }, 30000);
    });
  }
}

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const INFO = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const body = txt(document.body.innerText);
  const meta = (p) => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? m.getAttribute('content') : null; };

  // 互动四件套：动作栏渲染成「图标+数字」且没有文字标签，
  // 但顺序固定 = 点赞 评论 收藏 分享，紧跟在 "NNNN NNNN NNNN NNNN 举报" 里。
  // （历史 bug：用 stat('点赞') 匹配 "数字+标签"，永远匹配不到 → digg/comment 全是空）
  const quad = body.match(/(\\d+(?:\\.\\d+)?万?)\\s+(\\d+(?:\\.\\d+)?万?)\\s+(\\d+(?:\\.\\d+)?万?)\\s+(\\d+(?:\\.\\d+)?万?)\\s*举报/);
  const pick = (i) => (quad ? quad[i] : null);
  // 标签式统计（部分版式才有），作为兜底
  const stat = (label) => {
    const m = body.match(new RegExp('([\\\\d.]+\\\\u4e07?)\\\\s*' + label));
    return m ? m[1] : null;
  };

  const v = document.querySelector('video');
  const durTex = [...document.querySelectorAll('[class*="duration"],[class*="Duration"]')]
    .map((e) => txt(e.innerText)).find((t) => /^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(t)) || null;

  return {
    url: location.href,
    title: txt(document.title),
    desc: (meta('og:description') || '').slice(0, 200),
    publishTime: meta('article:published_time') || (body.match(/(20\\d{2}[-年]\\d{1,2}[-月]\\d{1,2})/) || [])[1] || null,
    dateText: (body.match(/(20\\d{2}[-.]\\d{1,2}[-.]\\d{1,2}|\\d{4}年\\d{1,2}月\\d{1,2}日|\\d+天前|\\d+月前|\\d+小时前|昨天)/) || [])[1] || null,
    play: stat('播放') || null,
    digg: pick(1) || stat('点赞') || null,
    comment: pick(2) || stat('评论') || null,
    collect: pick(3) || stat('收藏') || null,
    share: pick(4) || stat('分享') || null,
    // <video>.duration 是精确秒数，比 DOM 里的 mm:ss 更可靠
    durationSec: v && isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration) : null,
    durText: durTex,
    bodySample: body.slice(0, 260),
  };
})()`;

const works = JSON.parse(readFileSync(inFile, 'utf8'));
const results = [];
await s.send('Page.enable');

for (const [i, w] of works.items.entries()) {
  await s.send('Page.navigate', { url: w.href });
  await sleep(4200);
  const info = await ev(INFO);
  results.push({ ...w, ...info });
  console.log(`[${i + 1}/${works.items.length}] ${info.dateText || info.publishTime || '?'} | 赞${info.digg || '-'} 评${info.comment || '-'} | ${(info.title || w.title).slice(0, 46)}`);
}

writeFileSync(outFile, JSON.stringify({ source: inFile, scrapedAt: new Date().toISOString(), count: results.length, results }, null, 2), 'utf8');
console.log(`\nwrote ${results.length} -> ${outFile}`);
s.ws.close();
process.exit(0);
