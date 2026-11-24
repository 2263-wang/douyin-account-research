// rank.js — compare candidate accounts: scale, activity, recent performance.
//   node rank.js <batch-works.json>
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const parsePlay = (p) => {
  if (!p) return null;
  const s = String(p);
  if (s.includes('亿')) return Math.round(parseFloat(s) * 1e8);
  if (s.includes('万')) return Math.round(parseFloat(s) * 1e4);
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n) => (n == null ? '-' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n));
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const rows = d.results.filter((r) => r.ok).map((r) => {
  const plays = (r.items || []).map((v) => parsePlay(v.play)).filter((x) => x != null);
  return {
    sec: r.sec,
    fans: r.profile?.fans,
    likes: r.profile?.likes,
    worksCount: r.profile?.worksCount,
    bio: r.profile?.bio,
    sampled: (r.items || []).length,
    plays,
    median: med(plays),
    max: plays.length ? Math.max(...plays) : null,
    items: r.items || [],
  };
});

console.log('粉       获赞     作品  样本  中位播放   最高播放  | 简介');
console.log('-'.repeat(120));
for (const r of rows.sort((a, b) => (parsePlay(b.fans) ?? 0) - (parsePlay(a.fans) ?? 0))) {
  console.log(
    `${(r.fans || '?').padStart(7)} ${(r.likes || '?').padStart(8)} ${String(r.worksCount || '?').padStart(5)} ${String(r.sampled).padStart(5)}  ${fmt(r.median).padStart(8)}  ${fmt(r.max).padStart(8)}  | ${(r.bio || '').slice(0, 46)}`
  );
}

console.log('\n\n=== 各账号近期作品（前 8 条）===');
for (const r of rows) {
  console.log(`\n--- ${r.fans}粉 / 作品${r.worksCount} / 中位${fmt(r.median)} ---`);
  r.items.slice(0, 8).forEach((v) => console.log(`   ${String(v.play || '-').padStart(7)}  ${(v.title || '').replace(/^[^：]*：/, '').slice(0, 66)}`));
}
