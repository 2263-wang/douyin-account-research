# faster-whisper 转写：绕开 PyAV 解码器（av 19 与 faster-whisper 1.2.x 不兼容）
# 用法: python transcribe.py data/audio/xxx.wav [--model small] [--device cpu] [--outdir data/transcripts]
import argparse
import json
import os
import sys
import time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('audio')
ap.add_argument('--model', default='small')
ap.add_argument('--lang', default='zh')
ap.add_argument('--device', default=None, help='cuda / cpu，默认自动')
ap.add_argument('--prompt', default='以下是普通话的句子，请使用简体中文转写。')
ap.add_argument('--outdir', default='data/transcripts')
a = ap.parse_args()

src = Path(a.audio)
if not src.exists():
    sys.exit(f'找不到音频: {src}')

from faster_whisper import WhisperModel

device = a.device
compute = None
if device is None:
    try:
        import ctranslate2
        if 'cuda' in ctranslate2.get_supported_compute_types('cuda'):
            device, compute = 'cuda', 'float16'
    except Exception:
        pass
    if device is None:
        device, compute = 'cpu', 'int8'
# ctranslate2 4.8.x 不接受 compute_type=None
if compute is None:
    compute = 'float16' if device == 'cuda' else 'int8'


def decode_wav_pcm16(path, target_sr=16000):
    """自己解 16bit PCM wav -> float32 numpy，避开 faster-whisper 内置的 PyAV 解码"""
    import wave
    import numpy as np
    with wave.open(str(path), 'rb') as w:
        sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if sw != 2:
        raise ValueError(f'只支持 16bit PCM，实际 {sw * 8}bit')
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != target_sr:
        idx = np.linspace(0, len(x) - 1, int(len(x) * target_sr / sr))
        x = np.interp(idx, np.arange(len(x)), x).astype(np.float32)
    return x


t0 = time.time()
print(f'audio={src} ({src.stat().st_size / 1024 / 1024:.2f} MB) model={a.model} device={device} compute={compute}')
model = WhisperModel(a.model, device=device, compute_type=compute)
audio = decode_wav_pcm16(src)
print(f'decoded={len(audio) / 16000:.1f}s')

segments, info = model.transcribe(
    audio,
    language=a.lang,
    initial_prompt=a.prompt,
    vad_filter=True,
    vad_parameters=dict(min_silence_duration_ms=300),
    beam_size=5,
)

os.makedirs(a.outdir, exist_ok=True)
base = Path(a.outdir) / src.stem
rows, plain = [], []
for s in segments:
    t = s.text.strip()
    rows.append({'start': round(s.start, 2), 'end': round(s.end, 2), 'text': t})
    plain.append(t)
    print(f'[{s.start:7.2f} -> {s.end:7.2f}] {t}')

base.with_suffix('.txt').write_text('\n'.join(plain), encoding='utf-8')
base.with_suffix('.segments.json').write_text(
    json.dumps({'audio': str(src), 'duration': info.duration, 'segments': rows},
               ensure_ascii=False, indent=2), encoding='utf-8')

chars = sum(len(r['text']) for r in rows)
elapsed = time.time() - t0
print(f'\nsegments={len(rows)} chars={chars} elapsed={elapsed:.0f}s speed={info.duration / max(elapsed, 1):.1f}x')
print(f'out={base.with_suffix(".txt")}')
