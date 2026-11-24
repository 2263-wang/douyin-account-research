#!/usr/bin/env bash
# 把本包安装到 Codex 个人 skill 目录（macOS / Linux）
# 用法: bash install.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${HOME}/.codex/skills"
DEST="${DEST_ROOT}/douyin-account-research"

echo "源  : $SRC"
echo "目标: $DEST"

# 本脚本可能在包根（含内层 skill 目录），也可能就在 skill 目录里
if [ -d "$SRC/douyin-account-research" ]; then
  PAYLOAD="$SRC/douyin-account-research"
else
  PAYLOAD="$SRC"
fi

if [ -e "$DEST" ]; then
  echo ""
  read -r -p "目标已存在，覆盖？(y/N) " ans
  [ "$ans" = "y" ] || { echo "已取消"; exit 0; }
  rm -rf "$DEST"
fi

mkdir -p "$DEST_ROOT"
cp -R "$PAYLOAD" "$DEST"
chmod +x "$DEST/toolkit/launch.sh" 2>/dev/null || true

echo ""
echo "已安装。目录:"
ls -1 "$DEST"

cat <<EOF

下一步:
  1) 环境自检:  node "$DEST/scripts/verify-env.mjs"
  2) 离线试跑（不需要登录）:
     node "$DEST/scripts/run.mjs" --analyze-only --mode account \\
          --inputs "$DEST/examples" --outdir ./demo-out
  3) 起浏览器扫码登录:
     node "$DEST/scripts/launch.mjs"
  4) 跑真实账号:
     node "$DEST/scripts/run.mjs" --mode account --account "账号昵称"

注意: 不要删掉包里的 toolkit/ 目录；toolkit/profile/ 是登录态，别复制给别人。
EOF
