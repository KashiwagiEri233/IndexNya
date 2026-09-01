#!/usr/bin/env bash
# 一键启动 Index 学习岛（单进程 TypeScript 全栈）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请安装 Node.js 22.5+。" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Index 学习岛需要 Node.js 22.5+（当前：$(node -v)）。" >&2
  exit 1
fi

DESKTOP_MODE=0
for arg in "$@"; do
  if [ "$arg" = "--desktop" ] || [ "$arg" = "-d" ] || [ "$arg" = "-Desktop" ]; then
    DESKTOP_MODE=1
  fi
done

if [ ! -d "$ROOT/node_modules" ]; then
  echo "首次运行：安装前端与全栈依赖…"
  npm --prefix "$ROOT" install
fi

if [ "$DESKTOP_MODE" -eq 1 ]; then
  echo "=== 启动 Index 学习岛 Electron 桌面端 ==="
  exec npm --prefix "$ROOT" run dev:desktop
else
  echo "=== 启动 Index 学习岛 TS 全栈服务 (Web 模式) ==="
  echo "API 与前端由同一个 Node.js 进程提供，默认地址：http://localhost:5173"
  exec npm --prefix "$ROOT" run dev
fi
