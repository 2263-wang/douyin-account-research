// candidates.js — merge the search results into one deduped candidate pool.
//   node candidates.js <search-results-dir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || join(HERE, 'search-results');

const parseNum = (s) => {
  if (!s) return null;
  if (s.includes('万')) return Math.round(parseFloat(s) * 10000);
  if (s.includes('亿')) return Math.round(parseFloat(s) * 100000000);
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const pool = new Map();
const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
for (const f of files) {
  const kw = f.replace(/\.txt$/, '');
  const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    const head = line.match(/^\s{2}([A-Za-z0-9_-]{20,})\s*$/);
    if (head) { cur = head[1]; continue; }
    const body = line.match(/^\s{4}(?:赞([\d.]+[万亿]?)\s+粉([\d.]+[万亿]?))?\s*(.*)$/);
    if (cur && body && body[3]) {
      const key = cur;
      if (!pool.has(key)) {
        pool.set(key, {
          sec: key,
          likes: parseNum(body[1]),
          fans: parseNum(body[2]),
          text: body[3].replace(/^。*/, '').trim(),
          keywords: new Set(),
        });
      }
      pool.get(key).keywords.add(kw);
      cur = null;
    }
  }
}

const rows = [...pool.values()].map((r) => ({ ...r, keywords: [...r.keywords] }));
rows.sort((a, b) => (b.fans ?? -1) - (a.fans ?? -1));

const fmt = (n) => (n == null ? '-' : n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n));
console.log(`files: ${files.length}   unique accounts: ${rows.length}\n`);
console.log('fans     likes    | keywords            | 简介');
console.log('-'.repeat(110));
rows.forEach((r) => {
  const nick = r.text.split(/\s{2,}|关注|抖音号/)[0].slice(0, 22);
  console.log(`${fmt(r.fans).padStart(7)}  ${fmt(r.likes).padStart(7)}  | ${r.keywords.join(',').slice(0, 18).padEnd(19)} | ${nick} :: ${r.text.slice(0, 60)}`);
});

writeFileSync(join(HERE, 'candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2), 'utf8');
console.log(`\n-> candidates.json (${rows.length})`);
