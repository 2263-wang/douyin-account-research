#!/usr/bin/env bash
# 环境自检包装（macOS / Linux）。真正逻辑在 scripts/verify-env.mjs，跨平台共用。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 本脚本可能在包根，也可能在 skill 目录里
if [ -f "$DIR/scripts/verify-env.mjs" ]; then
  SKILL_DIR="$DIR"
elif [ -f "$DIR/douyin-account-research/scripts/verify-env.mjs" ]; then
  SKILL_DIR="$DIR/douyin-account-research"
else
  echo "找不到 scripts/verify-env.mjs"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没装 Node.js。装一个：https://nodejs.org"
  exit 1
fi

exec node "$SKILL_DIR/scripts/verify-env.mjs"
