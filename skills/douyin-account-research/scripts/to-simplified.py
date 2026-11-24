# 繁体转简体。Python 直接写文件，不要 print 出来再重定向（Windows 控制台编码会破坏中文）
# 用法: python to-simplified.py data/transcripts/a.txt data/transcripts/b.txt
import sys
from pathlib import Path

try:
    from opencc import OpenCC
except ImportError:
    sys.exit('缺少 opencc: pip install opencc-python-reimplemented')

cc = OpenCC('t2s')
for f in sys.argv[1:]:
    p = Path(f)
    if not p.exists():
        print(f'skip (not found): {p}')
        continue
    simp = cc.convert(p.read_text(encoding='utf-8'))
    out = p.with_suffix('.simp.txt')
    out.write_text(simp, encoding='utf-8')
    print(f'{p} -> {out}  ({len(simp.replace(chr(10), ""))} chars)')
