#!/bin/bash
# Splitter: start everything for Expo Go on a phone.
#   ./start-all.sh            PostgreSQL + backend (background) + Expo (foreground, QR visible)
#   ./start-all.sh --no-expo  everything except Expo (for checks)
# Stop with ./stop-all.sh (PostgreSQL is left running).
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
PGBIN="$HOME/.local/pg/node_modules/@embedded-postgres/darwin-arm64/native/bin"
PGDATA="$HOME/.local/pg/data"
BACKEND_DIR="$ROOT/splitter-backend-main"
FRONTEND_DIR="$ROOT/splitter-frontend-main"
BACKEND_LOG="/tmp/splitter-backend.log"
API_PORT="${API_PORT:-3001}"
METRO_PORT=8081
NO_EXPO=0
[ "${1:-}" = "--no-expo" ] && NO_EXPO=1

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# pid listening on a TCP port (empty when free)
listener() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
# true when the pid's working directory is inside the given project folder name
belongs_to() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | grep -q "/$2"; }

command -v node >/dev/null || die "node not found in ~/.local/node/bin"

say "PostgreSQL"
[ -x "$PGBIN/pg_ctl" ] || die "pg_ctl not found at $PGBIN"
if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "already running (left untouched)"
else
  "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5432 -c listen_addresses=127.0.0.1" -l "$HOME/.local/pg/pg.log" start >/dev/null || die "PostgreSQL did not start, see ~/.local/pg/pg.log"
  echo "started"
fi

say "Backend (port $API_PORT)"
pid="$(listener "$API_PORT")"
if [ -n "$pid" ] && belongs_to "$pid" "splitter-backend-main" && curl -fs -m3 "http://127.0.0.1:$API_PORT/health" >/dev/null; then
  echo "already running (pid $pid)"
elif [ -n "$pid" ]; then
  die "port $API_PORT is used by pid $pid. If it is an old Splitter backend run ./stop-all.sh, otherwise free the port."
else
  # NB: the whole subshell goes to the background and exec replaces it; "cd && cmd &" would leave a waiting parent shell
  ( cd "$BACKEND_DIR" && exec nohup npm start > "$BACKEND_LOG" 2>&1 < /dev/null ) &
  disown 2>/dev/null
  for _ in $(seq 60); do curl -fs -m1 "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -fs -m3 "http://127.0.0.1:$API_PORT/health" >/dev/null || { echo "--- last log lines (secrets masked):"; tail -15 "$BACKEND_LOG" | sed -E 's/(key|secret|password|token)([^ =:]*)[=:] *[^ ,]+/\1\2=***/Ig'; die "backend did not start, full log: $BACKEND_LOG"; }
  echo "started (pid $(listener "$API_PORT"), log $BACKEND_LOG)"
fi

say "Network"
IP="$(ipconfig getifaddr en0 2>/dev/null)"
[ -n "$IP" ] || IP="$(ipconfig getifaddr en1 2>/dev/null)"
[ -n "$IP" ] || die "no LAN IP: Wi-Fi is not connected. Connect to Wi-Fi and run again."
echo "LAN IP: $IP"
case "$IP" in
  172.20.10.*) echo "WARNING: this is an iPhone hotspot address. Expo Go on that same iPhone cannot reach it; use a shared Wi-Fi or a hotspot from a second phone." ;;
esac
curl -fs -m3 "http://$IP:$API_PORT/health" >/dev/null && echo "backend answers on http://$IP:$API_PORT/health" || echo "WARNING: backend does not answer on http://$IP:$API_PORT/health (firewall or network isolation?)"

say "EXPO_PUBLIC_API_URL"
# changes only that one line of splitter-frontend-main/.env
(cd "$FRONTEND_DIR" && API_PORT="$API_PORT" LAN_IP="$IP" node scripts/dev-lan.mjs --no-start | grep "EXPO_PUBLIC_API_URL")

say "Expo (port $METRO_PORT)"
mpid="$(listener "$METRO_PORT")"
if [ -n "$mpid" ]; then
  if belongs_to "$mpid" "splitter-frontend-main"; then
    echo "stopping the old Splitter Metro (pid $mpid) so the new one gets a fresh cache"
    kill "$mpid" 2>/dev/null; sleep 2
  else
    die "port $METRO_PORT is used by pid $mpid (not Splitter). Free it and run again."
  fi
fi

echo
echo "On the phone (same Wi-Fi, not mobile data; iOS: Settings > Expo Go > Local Network ON):"
echo "  1. Safari: http://$IP:$API_PORT/health   -> {\"status\":\"ok\"}"
echo "  2. Expo Go: scan the QR below or type  exp://$IP:$METRO_PORT"
echo

if [ "$NO_EXPO" = 1 ]; then
  echo "--no-expo: not starting Expo. Start it with:  cd splitter-frontend-main && REACT_NATIVE_PACKAGER_HOSTNAME=$IP npx expo start --lan -c --offline"
  exit 0
fi

cd "$FRONTEND_DIR" || die "frontend folder not found"
REACT_NATIVE_PACKAGER_HOSTNAME="$IP" exec npx expo start --lan -c --offline
