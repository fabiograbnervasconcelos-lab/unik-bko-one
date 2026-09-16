#!/usr/bin/env bash
# Keep a Cloudflare quick tunnel in front of the local panel.
# Quick tunnels are revoked by Cloudflare while cloudflared stays running
# ("Unauthorized: Tunnel not found"). Detect that, replace the hostname,
# and republish here.now so cozy-delta does not keep the dead DNS name.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/data/tunnel.log"
URL_FILE="$ROOT/data/tunnel-url.txt"
PUBLISH="/home/ubuntu/.cursor/plugins/cache/cursor-public/50420288/8ec223e927bb2247636aa0653536f63385f05298/skills/here-now/scripts/publish.sh"
CLOUDFLARED="${CLOUDFLARED_BIN:-$HOME/.local/bin/cloudflared}"
SLUGS=(cozy-delta-bsqr sable-hollow-2jgv)
mkdir -p "$ROOT/data"

if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "cloudflared not found at $CLOUDFLARED" >&2
  exit 1
fi

publish_site() {
  local url="$1"
  node "$ROOT/scripts/render-here-now.mjs" "$url"
  local slug
  for slug in "${SLUGS[@]}"; do
    echo "publishing $slug -> $url" >&2
    "$PUBLISH" "$ROOT/here-now-site" --slug "$slug" --client cursor \
      --title "Unik BKO One" --description "Painel ao vivo Unik BKO One" || true
  done
}

extract_url() {
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -n 1 || true
}

tunnel_healthy() {
  local url="$1"
  if grep -q "Unauthorized: Tunnel not found" "$LOG" 2>/dev/null; then
    return 1
  fi
  if grep -q "Unable to establish connection" "$LOG" 2>/dev/null; then
    return 1
  fi
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 12 -A "UnikBKO-health" "$url/api/health" || true)"
  [[ "$code" == "200" ]]
}

stop_pid() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
}

while true; do
  : > "$LOG"
  echo "starting cloudflared $(date -u +%FT%TZ)" | tee -a "$LOG" >&2
  "$CLOUDFLARED" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:43147" >> "$LOG" 2>&1 &
  pid=$!
  url=""
  for _ in $(seq 1 45); do
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    url="$(extract_url)"
    if [[ -n "$url" ]]; then
      break
    fi
  done
  if [[ -z "$url" ]] || ! kill -0 "$pid" 2>/dev/null; then
    echo "tunnel URL not found, retrying" >&2
    stop_pid "$pid"
    sleep 3
    continue
  fi

  echo "$url" > "$URL_FILE"
  echo "tunnel up: $url" >&2
  publish_site "$url"

  fails=0
  while kill -0 "$pid" 2>/dev/null; do
    if tunnel_healthy "$url"; then
      fails=0
    else
      fails=$((fails + 1))
      echo "tunnel health fail $fails $(date -u +%FT%TZ) $url" >&2
      if [[ "$fails" -ge 2 ]]; then
        echo "replacing dead tunnel" >&2
        break
      fi
    fi
    sleep 15
  done
  stop_pid "$pid"
  wait "$pid" 2>/dev/null || true
  echo "tunnel restarted in 3s" >&2
  sleep 3
done
