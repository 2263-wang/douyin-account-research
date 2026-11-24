// works.js — final scraper: Douyin profile header stats + all own video cards.
//   node works.js [secUidOrUrl] [outFile]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = process.argv[2] || 'MS4wLjABAAAAvYjKex1-sdw09VyvuHb6jPmwxMMBZohgjpdcdK_H4uq5LMo82v6s8JvFuQ5NuOfO';
const outFile = process.argv[3] || join(HERE, 'works.json');
const maxScrolls = Number(process.argv[4] || 14);
const url = arg.startsWith('http') ? arg : `https://www.douyin.com/user/${arg}`;

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
if (!page) { console.error('no page target — run start.ps1 first'); process.exit(1); }
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await s.send('Page.enable');
await s.send('Page.navigate', { url });
await sleep(6500);

const SCRAPE = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const body = txt(document.body.innerText);

  // --- header stats ---
  // Numbers are glued together in innerText ("...关注 53 粉丝 13.1万 获赞 1102.2万..."),
  // so anchor on each label and only allow a capped gap (no nested digits).
  const parseStats = (t) => {
    const clean = t.replace(/[\\u200b-\\u200f\\ufeff]/g, ' ').replace(/\\s+/g, ' ');
    const pick = (re) => { const m = clean.match(re); return m ? m[1] : null; };
    return {
      following: pick(/(?:^|[^\\d.])关注[：:]?\\s*([\\d.]+\\u4e07?)/),
      fans: pick(/粉丝[：:]?\\s*([\\d.]+\\u4e07?)/),
      likes: pick(/获赞[：:]?\\s*([\\d.]+\\u4e07?)/),
    };
  };
  const profile = {
    title: document.title,
    handle: (body.match(/抖音号[：:]\\s*([A-Za-z0-9_.-]+)/) || [])[1] || null,
    ip: (body.match(/IP属地[：:]\\s*([^ ]+)/) || [])[1] || null,
    ...parseStats(body),
    worksCount: (body.match(/作品\\s*(\\d+)/) || [])[1] || null,
    bio: (body.match(/抖音号[：:][\\s\\S]{0,60}?\\s([\\u4e00-\\u9fa5][^#]{4,120}?)(?:更多|分享主页)/) || [])[1] || null,
  };

  // --- own works: [data-e2e="user-post-list"] > ul > li ---
  const scope = document.querySelector('[data-e2e="user-post-list"]');
  const items = [];
  if (scope) {
    for (const li of scope.querySelectorAll('li')) {
      const a = li.querySelector('a[href*="/video/"]');
      if (!a) continue;
      const id = (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1];
      if (!id) continue;
      const t = txt(li.innerText);
      const img = li.querySelector('img');
      const alt = txt(img && img.getAttribute('alt'));
      const durEl = li.querySelector('[class*="duration"], [class*="Duration"]');
      items.push({
        id,
        href: 'https://www.douyin.com/video/' + id,
        title: alt || t,
        play: (t.match(/^([\\d.]+万?)/) || [])[1] || null,
        dur: durEl ? txt(durEl.innerText) : ((t.match(/\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b/) || [])[1] || null),
        raw: t.slice(0, 200),
      });
    }
  }
  return { profile, count: items.length, items };
})()`;

// Scroll the list a few times so lazy-loaded cards mount, then scrape.
const SCROLL = `(() => {
  const cands = [...document.querySelectorAll('div,main,section')]
    .filter((el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300)
    .sort((a, b) => b.clientHeight - a.clientHeight);
  const box = cands[0];
  if (box) box.scrollTop = box.scrollTop + box.clientHeight * 0.85;
  else window.scrollTo(0, document.body.scrollHeight);
  return { scrolled: box ? Math.round(box.scrollTop) : window.scrollY, cards: document.querySelectorAll('[data-e2e="user-post-list"] li').length };
})()`;

const mounted = new Map();
for (let i = 0; i < maxScrolls; i++) {
  const r = await ev(SCROLL);
  if (i === 0) console.log('scrolling list:', JSON.stringify(r));
  await sleep(1300);
}
// scroll back to top so the first pass sees everything that ever mounted
await ev(`(() => {
  const cands = [...document.querySelectorAll('div,main,section')]
    .filter((el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300)
    .sort((a, b) => b.clientHeight - a.clientHeight);
  if (cands[0]) cands[0].scrollTop = 0; else window.scrollTo(0, 0);
  return 1;
})()`);
await sleep(2000);

const r = await ev(SCRAPE);
const data = { page: url, scrapedAt: new Date().toISOString(), ...r };
writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');

console.log('profile:', JSON.stringify(r.profile, null, 2));
console.log(`\nown works: ${r.count} -> ${outFile}\n`);
r.items.forEach((v, i) => {
  console.log(`[${String(i + 1).padStart(2)}] play=${String(v.play || '-').padStart(8)}  dur=${v.dur || '--:--'}  ${v.title.slice(0, 90)}`);
});
s.ws.close();
process.exit(0);
