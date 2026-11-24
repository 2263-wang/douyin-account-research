#!/usr/bin/env bash
# 启动带调试端口的浏览器（macOS / Linux）
# 用法: bash toolkit/launch.sh [端口]
#
# 说明：真正的启动逻辑在 Node 里（scripts/launch.mjs），Windows/macOS/Linux 共用一份，
#      这里只是个方便记忆的包装。调用的 node 脚本会自动定位 skill 目录。
set -euo pipefail
PORT="${1:-9222}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 工具链可能位于 <skill>/toolkit 或 <包>/douyin-account-research/toolkit
SKILL_DIR="$(dirname "$DIR")"
LAUNCH="$SKILL_DIR/scripts/launch.mjs"

if [ ! -f "$LAUNCH" ]; then
  echo "找不到 $LAUNCH"
  echo "请改用: node <skill目录>/scripts/launch.mjs --port $PORT"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没装 Node.js。装一个：https://nodejs.org"
  exit 1
fi

exec node "$LAUNCH" --port "$PORT"
