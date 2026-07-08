#!/usr/bin/env bash
# NewsReel dev servers: ./scripts/dev.sh start|stop|status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.run"
mkdir -p "$LOGS"

port_pids() { lsof -tnP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }

start() {
  echo "▸ postgres (docker)"
  docker compose -f "$ROOT/docker-compose.yml" up -d

  if [ ! -d "$ROOT/backend/.venv" ]; then
    echo "▸ creating venv + installing backend deps (first run)"
    python3 -m venv "$ROOT/backend/.venv"
    "$ROOT/backend/.venv/bin/pip" -q install -r "$ROOT/backend/requirements.txt"
  fi
  if [ -z "$(port_pids 8001)" ]; then
    echo "▸ backend → http://localhost:8001 (log: .run/backend.log)"
    (cd "$ROOT/backend" && nohup .venv/bin/uvicorn app.main:app --port 8001 > "$LOGS/backend.log" 2>&1 &)
  else
    echo "▸ backend already running on :8001"
  fi

  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "▸ installing frontend deps (first run)"
    (cd "$ROOT/frontend" && npm install --silent)
  fi
  if [ -z "$(port_pids 5173)" ]; then
    echo "▸ frontend → http://localhost:5173 (log: .run/frontend.log)"
    (cd "$ROOT/frontend" && nohup npm run dev > "$LOGS/frontend.log" 2>&1 &)
  else
    echo "▸ frontend already running on :5173"
  fi

  # wait for backend health, then report
  for _ in $(seq 1 30); do
    if curl -sf localhost:8001/api/health > /dev/null 2>&1; then break; fi
    sleep 1
  done
  status
}

stop() {
  for port in 8001 5173; do
    pids="$(port_pids "$port")"
    if [ -n "$pids" ]; then
      echo "▸ stopping :$port (pid $pids)"
      kill $pids 2>/dev/null || true
    fi
  done
  echo "▸ stopping postgres container"
  docker compose -f "$ROOT/docker-compose.yml" stop
}

status() {
  echo "— status —"
  [ -n "$(port_pids 8001)" ] && echo "backend  : UP  http://localhost:8001 ($(curl -sf localhost:8001/api/health 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' 2>/dev/null || echo 'starting…'))" || echo "backend  : DOWN"
  [ -n "$(port_pids 5173)" ] && echo "frontend : UP  http://localhost:5173" || echo "frontend : DOWN"
  docker compose -f "$ROOT/docker-compose.yml" ps --format '{{.Service}}: {{.Status}}' 2>/dev/null | sed 's/^/db       : /' || echo "db       : DOWN"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
