#!/usr/bin/env bash
# 一键启动 Index 学习岛（前后端）
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "=== 启动后端 (FastAPI :8000) ==="
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  echo "首次运行：创建虚拟环境"
  python3.14 -m venv .venv 2>/dev/null || python3.12 -m venv .venv || python3 -m venv .venv
  .venv/bin/pip install --upgrade pip -q
  .venv/bin/pip install -e . -q
fi
.venv/bin/uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!
echo "后端 PID: $BACKEND_PID"

echo "=== 启动前端 (Vite :5173) ==="
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev &
FRONTEND_PID=$!
echo "前端 PID: $FRONTEND_PID"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
echo ""
echo "✅ 启动完成："
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:8000/docs"
echo "   按 Ctrl+C 退出"
wait
