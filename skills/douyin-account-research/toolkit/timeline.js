// timeline.js — Douyin video ids encode the publish time in their high bits.
//   ts = (id >> 32) + 1420041600000   (ms since epoch, base = 2015-01-01)
//   node timeline.js <works.json>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const data = JSON.parse(readFileSync(file, 'utf8'));
const BASE = 1420041600000n;

const rows = data.items.map((w) => {
  const ts = Number((BigInt(w.id) >> 32n) + BASE);
  return { ...w, date: new Date(ts) };
}).sort((a, b) => a.date - b.date);

const fmt = (d) => d.toISOString().slice(0, 10);
const parsePlay = (p) => {
  if (!p) return null;
  if (p.includes('万')) return Math.round(parseFloat(p) * 10000);
  return parseInt(p, 10);
};

console.log(`total: ${rows.length}`);
console.log(`range: ${fmt(rows[0].date)} → ${fmt(rows[rows.length - 1].date)}\n`);

// group by month
const byMonth = new Map();
for (const r of rows) {
  const k = fmt(r.date).slice(0, 7);
  if (!byMonth.has(k)) byMonth.set(k, []);
  byMonth.get(k).push(r);
}

console.log('month     count   median     max   |  titles sample');
for (const [k, list] of [...byMonth.entries()].sort()) {
  const plays = list.map((r) => parsePlay(r.play)).filter((x) => x != null).sort((a, b) => a - b);
  const med = plays.length ? plays[Math.floor(plays.length / 2)] : null;
  const max = plays.length ? plays[plays.length - 1] : null;
  const sample = list.slice(0, 2).map((r) => r.title.replace(/^[^：]{1,20}：/, '').slice(0, 34)).join(' / ');
  console.log(`${k}   ${String(list.length).padStart(4)}   ${String(med ?? '-').padStart(7)}   ${String(max ?? '-').padStart(7)}   | ${sample}`);
}

// last 20 by date
console.log('\n=== 最近 20 条（按时间倒序）===');
[...rows].reverse().slice(0, 20).forEach((r) => {
  console.log(`${fmt(r.date)}  ${String(r.play || '-').padStart(7)}  ${r.title.replace(/^[^：]{1,20}：/, '').slice(0, 60)}`);
});

// gaps
console.log('\n=== 按月的更新间隔（该月内相邻两条的中位天数）===');
for (const [k, list] of [...byMonth.entries()].sort()) {
  const gaps = [];
  for (let i = 1; i < list.length; i++) gaps.push((list[i].date - list[i - 1].date) / 86400000);
  gaps.sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)].toFixed(1) : '-';
  console.log(`${k}   条数=${String(list.length).padStart(3)}   中位间隔=${med} 天`);
}
