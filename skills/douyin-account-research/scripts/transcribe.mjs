// 转写：详情 JSON -> 音频 -> 逐字稿（含时间戳）
// 用法: node transcribe.mjs [--detail data/detail] [--model small] [--device cpu] [--limit 5] [--ids a,b]
//
// 依赖: ffmpeg (PATH), python + faster-whisper, scripts/transcribe.py
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { arg, ensureDir, writeJson, mmss } from './lib/cdp.mjs';

const argv = process.argv.slice(2);
const DETAIL = path.resolve(arg(argv, 'detail', 'data/detail'));
const AUDIO = ensureDir(path.resolve(arg(argv, 'audio', 'data/audio')));
const TRANS = ensureDir(path.resolve(arg(argv, 'transcripts', 'data/transcripts')));
const MODEL = arg(argv, 'model', 'small');
const DEVICE = arg(argv, 'device', 'cpu');
const LIMIT = Number(arg(argv, 'limit', '5'));
const ONLY = arg(argv, 'ids', '').split(',').map((s) => s.trim()).filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
const REFERER = 'https://www.douyin.com/';

if (!fs.existsSync(DETAIL)) { console.error(`详情目录不存在: ${DETAIL}`); process.exit(1); }

let files = fs.readdirSync(DETAIL).filter((f) => /^\d+\.json$/.test(f));
if (ONLY.length) files = files.filter((f) => ONLY.includes(f.replace('.json', '')));
files = files.slice(0, LIMIT);
if (!files.length) { console.error('没有可转写的详情文件'); process.exit(1); }

// 挑最高码率的播放地址（web 端是音视频合一的 mp4）
function bestUrl(a) {
  const v = a.video || {};
  const gears = (v.bit_rate || [])
    .filter((g) => g.play_addr?.url_list?.length)
    .sort((x, y) => (y.bit_rate || 0) - (x.bit_rate || 0));
  return gears[0]?.play_addr.url_list[0] || v.play_addr?.url_list?.[0] || null;
}

const done = [];
for (const f of files) {
  const id = f.replace('.json', '');
  const a = JSON.parse(fs.readFileSync(path.join(DETAIL, f), 'utf8')).aweme_detail;
  if (!a) continue;

  const wav = path.join(AUDIO, `${id}.wav`);
  const info = {
    awemeId: id,
    author: a.author?.nickname || '',
    desc: (a.desc || '').replace(/\s+/g, ' ').slice(0, 60),
    durationSec: a.video?.duration ? Math.round(a.video.duration / 1000) : null,
    digg: a.statistics?.digg_count ?? null,
  };

  if (!fs.existsSync(wav)) {
    const url = bestUrl(a);
    if (!url) { console.log(`  ${id}: 没有可用播放地址，跳过`); continue; }
    console.log(`  ${id} 抽音轨 (${info.durationSec}s)...`);
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-user_agent', UA, '-referer', REFERER,
        '-i', url, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
      ], { stdio: 'inherit' });
    } catch (e) { console.log(`  ${id}: ffmpeg 失败 ${e.message}`); continue; }
  }

  const txt = path.join(TRANS, `${id}.txt`);
  if (!fs.existsSync(txt)) {
    console.log(`  ${id} 转写 (model=${MODEL})...`);
    const t0 = Date.now();
    try {
      execFileSync('python', [path.join(import.meta.dirname, 'transcribe.py'), wav,
        '--model', MODEL, '--device', DEVICE, '--outdir', TRANS], { stdio: 'inherit' });
      console.log(`  ${id} 转写完成 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) { console.log(`  ${id}: 转写失败 ${e.message}`); continue; }
  }

  const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : '';
  const first = text.split('\n').filter(Boolean)[0] || '';
  done.push({ ...info, chars: text.replace(/\s/g, '').length, opening: first.slice(0, 60) });
  console.log(`  ${id} OK  ${info.durationSec}s  ${done.at(-1).chars} 字`);
}

writeJson(path.join(path.dirname(TRANS), 'transcripts-index.json'), done);
console.log(`\n[transcribe] done=${done.length}`);
done.forEach((d) => console.log(`  ${d.awemeId}  ${mmss(d.durationSec)}  ${d.chars}字  ${d.opening}`));
