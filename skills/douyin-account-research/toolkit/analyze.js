// analyze.js — read the vstats output and produce the full monthly timeline.
//   node analyze.js <vstats.json>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const data = JSON.parse(readFileSync(file, 'utf8'));
const rows = data.results || [];

const parsePlay = (p) => {
  if (!p) return null;
  const s = String(p);
  if (s.includes('万')) return Math.round(parseFloat(s) * 10000);
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

// date resolution: publishTime (meta) > dateText
const dateOf = (r) => {
  const p = r.publishTime;
  if (p && /^\d{4}-\d{2}-\d{2}/.test(p)) return p.slice(0, 10);
  const d = r.dateText;
  if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  return null; // relative dates like "昨天"/"1月前" — resolve against scrape date later
};

const scrapeDay = (data.scrapedAt || '').slice(0, 10);
const resolved = rows.map((r) => ({ ...r, date: dateOf(r), playN: parsePlay(r.play) }));
const missing = resolved.filter((r) => !r.date);

// month buckets
const byMonth = new Map();
for (const r of resolved) {
  if (!r.date) continue;
  const k = r.date.slice(0, 7);
  if (!byMonth.has(k)) byMonth.set(k, []);
  byMonth.get(k).push(r);
}

const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const fmtN = (n) => (n == null ? '-' : n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n));

console.log(`scraped at     : ${scrapeDay}`);
console.log(`total rows     : ${rows.length}`);
console.log(`dated rows     : ${resolved.length - missing.length}`);
console.log(`unresolved     : ${missing.length} (relative dates)`);
const dated = resolved.filter((r) => r.date).map((r) => r.date).sort();
console.log(`date range     : ${dated[0]} → ${dated[dated.length - 1]}`);
console.log(`this month so far (${scrapeDay.slice(0, 7)}): ${resolved.filter((r) => r.date && r.date.startsWith(scrapeDay.slice(0, 7))).length}\n`);

console.log('month     count   median    max   |  sample');
for (const k of [...byMonth.keys()].sort()) {
  const list = byMonth.get(k);
  const plays = list.map((r) => r.playN).filter((x) => x != null);
  const sample = list[0].title.replace(/^[^：]{1,20}：/, '').slice(0, 40);
  console.log(`${k}   ${String(list.length).padStart(4)}   ${fmtN(med(plays)).padStart(7)}   ${fmtN(plays.length ? Math.max(...plays) : null).padStart(6)}   | ${sample}`);
}

console.log('\n=== monthly cadence (days between consecutive posts, median) ===');
const months = [...byMonth.keys()].sort();
for (const k of months) {
  const list = byMonth.get(k).slice().sort((a, b) => a.date.localeCompare(b.date));
  const gaps = [];
  for (let i = 1; i < list.length; i++) {
    gaps.push((new Date(list[i].date) - new Date(list[i - 1].date)) / 86400000);
  }
  const m = gaps.length ? med(gaps.map((g) => Math.round(g * 10) / 10)) : null;
  console.log(`${k}  n=${String(list.length).padStart(3)}  median gap=${m == null ? '-' : m.toFixed(1)}d  first=${list[0].date}  last=${list[list.length - 1].date}`);
}
