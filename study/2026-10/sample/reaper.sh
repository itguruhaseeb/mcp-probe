#!/bin/bash
# reaper.sh: kill server processes orphaned by the probe harness.
# mcp-probe kills its direct child (npx) on timeout; a server that re-spawns
# itself or forks workers leaves grandchildren reparented to PID 1. One such
# server (tribunal 1.3.2) left 659 processes and 5.5 GB resident during the
# first October chunk. This loop kills any process reparented to PID 1 that
# started after the reaper did and is not part of the session runtime.
START=$(awk '{print $1}' /proc/uptime | cut -d. -f1)
LOG=${1:-reaper.log}
while true; do
  for d in /proc/[0-9]*; do
    pid=${d#/proc/}
    [ "$pid" = "$$" ] && continue
    stat=$(cat "$d/stat" 2>/dev/null) || continue
    ppid=$(echo "$stat" | awk '{print $4}')
    [ "$ppid" = "1" ] || continue
    st=$(echo "$stat" | awk '{print $22}'); st=$((st/100))
    [ "$st" -ge "$START" ] || continue
    cmd=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)
    case "$cmd" in *claude*|*environment-manager*|*rclone*|*probe-sample*|*reaper.sh*|"") continue;; esac
    echo "$(date -u +%FT%TZ) kill $pid ppid=$ppid cmd=${cmd:0:120}" >> "$LOG"
    kill -9 "$pid" 2>/dev/null
  done
  sleep 3
done
