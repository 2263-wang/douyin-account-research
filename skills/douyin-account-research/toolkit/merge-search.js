// merge-search.js — merge all clicksearch-*.json files, extract the account behind
// each video (@handle appears in the card text), and rank accounts by keyword overlap.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((f) => f.startsWith('clicksearch-') && f.endsWith('.json'));

const parsePlay = (s) => {
  if (!s) return null;
  if (s.includes('亿')) return Math.round(parseFloat(s) * 1e8);
  if (s.includes('万')) return Math.round(parseFloat(s) * 1e4);
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n) => (n == null ? '-' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n));
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const accounts = new Map();
const allVideos = [];
let kwCount = 0;

for (const f of files) {
  const d = JSON.parse(readFileSync(join(HERE, f), 'utf8'));
  const kw = d.keyword;
  kwCount++;
  for (const c of d.cards || []) {
    // card text looks like: "合集 10:24 5587 深入理解... #ai #ai应用开发 @懂王Ai 2月前"
    const t = c.text || '';
    const handle = (t.match(/@([^\s#，,。]{1,28})/) || [])[1] || null;
    const play = (t.match(/\s(\d+(?:\.\d+)?万?)\s/) || [])[1] || null;
    const title = t.replace(/^(合集|专属会员)\s*/, '').replace(/^\d{1,2}:\d{2}\s*/, '').replace(/^\d+(?:\.\d+)?万?\s*/, '');
    const rec = { id: c.id, keyword: kw, handle, play: parsePlay(play), title: title.slice(0, 140) };
    allVideos.push(rec);
    if (handle) {
      if (!accounts.has(handle)) accounts.set(handle, { handle, keywords: new Set(), titles: [], plays: [] });
      const a = accounts.get(handle);
      a.keywords.add(kw);
      a.titles.push(rec.title);
      if (rec.play != null) a.plays.push(rec.play);
    }
  }
}

const rows = [...accounts.values()].map((a) => ({
  handle: a.handle,
  keywords: [...a.keywords],
  videoCount: a.titles.length,
  median: med(a.plays),
  max: a.plays.length ? Math.max(...a.plays) : null,
  sample: a.titles[0] ? a.titles[0].slice(0, 70) : '',
})).sort((x, y) => y.videoCount - x.videoCount || (y.median ?? 0) - (x.median ?? 0));

console.log(`files: ${files.length}  keywords: ${kwCount}  videos: ${allVideos.length}  accounts: ${rows.length}\n`);
console.log('命中  中位播放   最高  | 账号              | 代表作品');
console.log('-'.repeat(120));
rows.forEach((r) => {
  console.log(
    `${String(r.videoCount).padStart(3)}  ${fmt(r.median).padStart(8)}  ${fmt(r.max).padStart(7)}  | @${r.handle.padEnd(16).slice(0, 16)} | ${r.sample}`
  );
});

// highest-performing individual videos across all keywords
console.log('\n\n=== 全部结果里播放最高的 25 条 ===');
allVideos.filter((v) => v.play != null).sort((a, b) => b.play - a.play).slice(0, 25)
  .forEach((v) => console.log(`${fmt(v.play).padStart(8)}  @${(v.handle || '?').padEnd(14).slice(0, 14)}  [${v.keyword}]  ${v.title.slice(0, 72)}`));

writeFileSync(join(HERE, 'search-merged.json'), JSON.stringify({ at: new Date().toISOString(), keywords: kwCount, videos: allVideos.length, accounts: rows, allVideos }, null, 2), 'utf8');
console.log('\n-> search-merged.json');
