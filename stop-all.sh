#!/bin/bash
# Stops the Splitter backend and Expo/Metro started from this folder. PostgreSQL is left running.
# Only processes whose working directory is splitter-backend-main / splitter-frontend-main are touched.
set -u

kill_project_procs() { # $1 = project folder name, $2.. = ps patterns
  local proj="$1"; shift
  local pids="" p pat
  for pat in "$@"; do pids="$pids $(pgrep -f "$pat" 2>/dev/null)"; done
  for p in $(printf '%s\n' $pids | sort -u); do
    if lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep -q "/$proj"; then
      echo "stopping pid $p ($(ps -o command= -p "$p" | cut -c1-70))"
      kill "$p" 2>/dev/null
    fi
  done
}
kill_port_owner() { # $1 = port, $2 = project folder name
  local p; p="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [ -n "$p" ] || return 0
  if lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep -q "/$2"; then
    echo "stopping pid $p on port $1"
    kill "$p" 2>/dev/null
  else
    echo "port $1 is used by pid $p, which is not Splitter: left alone"
  fi
}

kill_port_owner 3001 splitter-backend-main
kill_port_owner 8081 splitter-frontend-main
kill_project_procs splitter-backend-main "ts-node/esm" "npm start"
kill_project_procs splitter-frontend-main "expo start" "dev-lan.mjs" "npm exec expo" "npm run dev:lan"

sleep 2
for entry in "3001:backend" "8081:Expo/Metro"; do
  port="${entry%%:*}"; name="${entry#*:}"
  if [ -n "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)" ]; then echo "port $port ($name) is still busy"; else echo "port $port ($name): free"; fi
done
echo "PostgreSQL was left running."
