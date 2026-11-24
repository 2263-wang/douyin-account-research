// batch-works.js — scrape several profiles in one browser session, gently.
//   node batch-works.js <secUidFile.json|comma-separated> <outFile>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_BROWSER_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = process.argv[2];
const outFile = process.argv[3] || join(HERE, 'batch-works.json');
if (!src) { console.error('usage: node batch-works.js <secUidsFile|a,b,c> <outFile>'); process.exit(1); }

let secs;
if (src.endsWith('.json')) {
  const j = JSON.parse(readFileSync(src, 'utf8'));
  secs = (j.candidates || j.rows || j).map((x) => (typeof x === 'string' ? x : x.sec)).filter(Boolean);
} else {
  secs = src.split(',').map((x) => x.trim()).filter(Boolean);
}
console.log(`profiles to scrape: ${secs.length}`);

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
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('timeout ' + m)); }, 25000);
    });
  }
}

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page — run launch.ps1'); process.exit(1); }
const s = await S.open(page.webSocketDebuggerUrl);
const ev = async (e) => {
  const r = await s.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return null;
  return r.result.value;
};

const SCRAPE = `(() => {
  const txt = (t) => (t || '').replace(/[\\u200b-\\u200f\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const body = txt(document.body.innerText);
  const pick = (re) => { const m = body.match(re); return m ? m[1] : null; };
  const profile = {
    title: document.title,
    handle: pick(/抖音号[：:]\\s*([A-Za-z0-9_.-]+)/),
    fans: pick(/粉丝[：:]?\\s*([\\d.]+万?)/),
    likes: pick(/获赞[：:]?\\s*([\\d.]+万?)/),
    worksCount: pick(/作品\\s*(\\d+)/),
    bio: (body.match(/抖音号[：:][\\s\\S]{0,70}?\\s([\\u4e00-\\u9fa5][^#]{4,110}?)(?:更多|分享主页)/) || [])[1] || null,
  };
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
      items.push({
        id,
        play: (t.match(/^([\\d.]+万?)/) || [])[1] || null,
        title: txt(img && img.getAttribute('alt')) || t.slice(0, 110),
      });
    }
  }
  return { profile, count: items.length, items };
})()`;

const results = [];
await s.send('Page.enable');
for (const [i, sec] of secs.entries()) {
  const url = `https://www.douyin.com/user/${sec}`;
  await s.send('Page.navigate', { url });
  await sleep(6000);
  const r = await ev(SCRAPE);
  if (!r) { console.log(`[${i + 1}/${secs.length}] scrape failed`); results.push({ sec, ok: false }); continue; }
  results.push({ sec, ok: true, ...r });
  const p = r.profile || {};
  console.log(`[${i + 1}/${secs.length}] 粉${p.fans || '?'} 获赞${p.likes || '?'} 作品${p.worksCount || '?'}  视频${r.count}  ${(p.bio || '').slice(0, 40)}`);
  // gentle pacing — avoid hammering
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), count: results.length, results }, null, 2), 'utf8');
  await sleep(2500);
}
console.log(`\n-> ${outFile}`);
s.ws.close();
process.exit(0);
