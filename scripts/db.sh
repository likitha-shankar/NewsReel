#!/usr/bin/env bash
# Quick DB access. Usage:
#   ./scripts/db.sh                     open an interactive psql shell
#   ./scripts/db.sh "SELECT ..."        run one query
#   ./scripts/db.sh episodes            shortcut: recent episodes
#   ./scripts/db.sh prefs               shortcut: the preferences row
set -euo pipefail
# -it only for the interactive shell; one-off queries run without a TTY (works in scripts/pipes too)
DB=(docker exec prosper-db-1 psql -U prosper -d prosper)

case "${1:-}" in
  "")        exec docker exec -it prosper-db-1 psql -U prosper -d prosper ;;
  episodes)  exec "${DB[@]}" -c "SELECT id, status, stage, format, qa_score, duration_seconds, trigger, left(title,40) AS title FROM episodes WHERE NOT deleted ORDER BY id DESC;" ;;
  prefs)     exec "${DB[@]}" -c "SELECT podcast_name, interests, episode_minutes, tone, depth, language, host_mode, schedule_enabled, schedule_hour FROM preferences;" ;;
  *)         exec "${DB[@]}" -c "$1" ;;
esac
