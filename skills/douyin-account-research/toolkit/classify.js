// classify.js — clean the date field, rebuild the timeline, and measure whether
// "task" topics actually outperform "news" topics.
//   node classify.js <dates.json>
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const d = JSON.parse(readFileSync(file, 'utf8'));
const ANCHOR = new Date('2026-10-09T00:00:00Z');
const DAY = 86400000;

const parsePlay = (p) => {
  if (!p) return null;
  const s = String(p);
  if (s.includes('万')) return Math.round(parseFloat(s) * 10000);
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

// resolve relative time -> absolute
const fromRel = (rel) => {
  if (!rel) return null;
  const m = rel.match(/^(\d+)\s*(小时|天|月|年)前$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const days = unit === '小时' ? 0 : unit === '天' ? n : unit === '月' ? n * 30.4 : n * 365;
    return new Date(ANCHOR.getTime() - days * DAY);
  }
  if (/昨天/.test(rel)) return new Date(ANCHOR.getTime() - DAY);
  if (/前天/.test(rel)) return new Date(ANCHOR.getTime() - 2 * DAY);
  return null;
};

// for month/year granularity the relative value is coarse, so trust abs; for
// day/hour granularity the relative value is precise, so trust rel.
const resolve = (r) => {
  const abs = r.abs ? new Date(r.abs + 'T00:00:00Z') : null;
  const rel = fromRel(r.rel);
  if (!abs && !rel) return { date: null, src: 'none' };
  if (!rel) return { date: abs, src: 'abs' };
  if (!abs) return { date: rel, src: 'rel' };
  const diff = Math.abs(abs - rel) / DAY;
  if (/小时|天/.test(r.rel || '') && diff > 12) return { date: rel, src: 'rel(precise)' };
  return { date: abs, src: 'abs' };
};

const rows = d.results.map((r) => {
  const { date, src } = resolve(r);
  return { ...r, date, src, playN: parsePlay(r.play) };
});
const dated = rows.filter((r) => r.date);

// --- topic classification (keyword based, title only) ---
const NEWS = [
  /升级|更新|发布了|上线|来了|大更新|新版|2\.0|2\.5|3\.0|4\.0|5\.0|4\.5/i,
  /实测|深度实测|开箱|测评|对决|大战|PK/i,
  /发布.*(榜|模型|Agent)/,
];
const TASK = [
  /教程|手把手|零基础|学会|教你|保姆|草履虫|小白|入门/i,
  /怎么|如何|搞定|全流程|流程|用法|玩法|指南|大法|攻略/i,
  /效率|办公|职场|表格|PPT|会议|纪要|文案|写作|剪辑|降噪/i,
];
const score = (title) => {
  const t = title.replace(/^[^：]{1,20}：/, '');
  let task = 0, news = 0;
  TASK.forEach((re) => { if (re.test(t)) task++; });
  NEWS.forEach((re) => { if (re.test(t)) news++; });
  return { task, news, kind: task > news ? 'task' : news > task ? 'news' : 'other' };
};

const scored = dated.map((r) => ({ ...r, ...score(r.title) }));

const med = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const fmt = (n) => (n == null ? '-' : n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n));

console.log(`dated rows: ${dated.length} / ${rows.length}`);
console.log(`source: abs=${dated.filter((r) => r.src === 'abs').length}  rel(precise)=${dated.filter((r) => r.src === 'rel(precise)').length}  rel=${dated.filter((r) => r.src === 'rel').length}\n`);

// --- monthly timeline ---
const byMonth = new Map();
for (const r of dated) {
  const k = r.date.toISOString().slice(0, 7);
  if (!byMonth.has(k)) byMonth.set(k, []);
  byMonth.get(k).push(r);
}
console.log('month     count   median    max   |  kind split');
for (const k of [...byMonth.keys()].sort()) {
  const list = byMonth.get(k);
  const plays = list.map((r) => r.playN).filter((x) => x != null);
  const t = list.filter((r) => r.kind === 'task').length;
  const n = list.filter((r) => r.kind === 'news').length;
  console.log(`${k}   ${String(list.length).padStart(4)}   ${fmt(med(plays)).padStart(7)}   ${fmt(plays.length ? Math.max(...plays) : null).padStart(6)}   | task=${t} news=${n}`);
}

// --- the real question: does task beat news? ---
console.log('\n=== 选题阀门测试：任务型 vs 新闻型 ===');
for (const kind of ['task', 'news', 'other']) {
  const list = scored.filter((r) => r.kind === kind && r.playN != null);
  if (!list.length) continue;
  const plays = list.map((r) => r.playN);
  const top = list.slice().sort((a, b) => b.playN - a.playN).slice(0, 5);
  console.log(`\n[${kind}] n=${list.length}  median=${fmt(med(plays))}  mean=${fmt(Math.round(plays.reduce((a, b) => a + b, 0) / plays.length))}  max=${fmt(Math.max(...plays))}`);
  top.forEach((r) => console.log(`    ${fmt(r.playN).padStart(7)}  ${r.title.replace(/^[^：]{1,20}：/, '').slice(0, 56)}`));
}

// --- top / bottom 10 overall ---
const withPlays = scored.filter((r) => r.playN != null).sort((a, b) => b.playN - a.playN);
console.log('\n=== TOP 10 ===');
withPlays.slice(0, 10).forEach((r) => console.log(`${fmt(r.playN).padStart(7)}  [${r.kind}]  ${r.title.replace(/^[^：]{1,20}：/, '').slice(0, 60)}`));
console.log('\n=== BOTTOM 10 ===');
withPlays.slice(-10).forEach((r) => console.log(`${fmt(r.playN).padStart(7)}  [${r.kind}]  ${r.title.replace(/^[^：]{1,20}：/, '').slice(0, 60)}`));

writeFileSync(file.replace(/\.json$/, '-classified.json'), JSON.stringify({ anchor: ANCHOR.toISOString(), scored }, null, 2), 'utf8');
console.log('\n-> wrote classified file');
