#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/data/tunnel.log"
URL_FILE="$ROOT/data/tunnel-url.txt"
PUBLISH="/home/ubuntu/.cursor/plugins/cache/cursor-public/50420288/8ec223e927bb2247636aa0653536f63385f05298/skills/here-now/scripts/publish.sh"
CLOUDFLARED="${CLOUDFLARED_BIN:-$HOME/.local/bin/cloudflared}"
mkdir -p "$ROOT/data"

if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "cloudflared not found at $CLOUDFLARED" >&2
  exit 1
fi

SLUGS=(cozy-delta-bsqr sable-hollow-2jgv)

publish_site() {
  local url="$1"
  node "$ROOT/scripts/render-here-now.mjs" "$url"
  local slug
  for slug in "${SLUGS[@]}"; do
    echo "publishing $slug" >&2
    "$PUBLISH" "$ROOT/here-now-site" --slug "$slug" --client cursor \
      --title "Unik BKO One" --description "Painel ao vivo Unik BKO One" || true
  done
}

extract_url() {
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -n 1 || true
}

while true; do
  : > "$LOG"
  echo "starting cloudflared $(date -u +%FT%TZ)" >> "$LOG"
  "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:43147" >> "$LOG" 2>&1 &
  pid=$!
  url=""
  for _ in $(seq 1 40); do
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    url="$(extract_url)"
    if [[ -n "$url" ]]; then
      break
    fi
  done
  if [[ -z "$url" ]]; then
    echo "tunnel URL not found, retrying" >&2
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    sleep 3
    continue
  fi
  echo "$url" > "$URL_FILE"
  echo "tunnel up: $url" >&2
  publish_site "$url"
  wait "$pid" || true
  echo "tunnel exited, restarting in 5s" >&2
  sleep 5
done
