#!/usr/bin/env bash
# =====================================================
# qa-env.sh — can a QA pass run right now?
# =====================================================
#
#   qa-env.sh [--start]
#
#     --start   bring up whatever is missing, in the background
#
# One authoritative answer to "is the environment ready", in the same shape as
# verify.sh: sort-indexed steps, WARN / CAUSE / HINT lines, and a
# `VERDICT: READY | BLOCKED` block as the LAST thing on stdout.
#
# It exists because the most expensive QA failure is not a missed bug — it is a
# whole report written against a stack that was not running, or was running the
# previous build. Those findings all look real.
#
# THE ONE THING THIS SCRIPT WILL NOT DO: SEED.
# It starts services. It never writes to your database, and it never resets one.
# Those are reasonable things for a human to run deliberately and unreasonable
# things for a QA pass to do behind your back.
#
# Add a check by copying a `record` block. Every check must be read-only.
# =====================================================
set -uo pipefail

START=0
[[ "${1:-}" == "--start" ]] && START=1

RUNDIR=$(mktemp -d -t nextjs-shadcn-qaenv)
trap 'rm -rf "$RUNDIR"' EXIT

BLOCKED=0

record() {  # record <idx> <name> <READY|BLOCKED> <detail>
  printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >>"$RUNDIR/results"
  [[ "$3" == "BLOCKED" ]] && BLOCKED=1
  return 0
}
warn()  { printf '%s\n' "$1" >>"$RUNDIR/warnings"; }
cause() { printf '%s\n' "$1" >>"$RUNDIR/causes"; }

port_open() {  # port_open <port>
  nc -z localhost "$1" >/dev/null 2>&1
}

# =====================================================
# CHECKS
# =====================================================

# --- 10. the frontend dev server -------------------------------------------
FRONTEND_PORT="${QA_WEB_PORT:-3000}"
if port_open "$FRONTEND_PORT"; then
  record 10 "web" READY "listening on $FRONTEND_PORT"
elif [[ $START -eq 1 ]]; then
  ( cd "apps/web" && nohup npm run dev >"$RUNDIR/web.log" 2>&1 & ) || true
  for _ in $(seq 1 30); do port_open "$FRONTEND_PORT" && break; sleep 1; done
  if port_open "$FRONTEND_PORT"; then
    record 10 "web" READY "started on $FRONTEND_PORT"
  else
    record 10 "web" BLOCKED "did not come up on $FRONTEND_PORT within 30s"
    cause "WEB_NOT_RUNNING"
  fi
else
  record 10 "web" BLOCKED "nothing listening on $FRONTEND_PORT"
  cause "WEB_NOT_RUNNING"
fi

# --- 20. the backend API ----------------------------------------------------
API_PORT="${QA_API_PORT:-3311}"
if port_open "$API_PORT"; then
  record 20 "api" READY "listening on $API_PORT"
else
  # A frontend without its API produces findings that are all the same finding.
  record 20 "api" BLOCKED "nothing listening on $API_PORT"
  cause "API_NOT_RUNNING"
fi

# --- 30. is the running build the one under test? ---------------------------
# Not decidable from here — only the tester can match an artifact from the diff
# against what the app actually renders. Say so rather than implying it passed.
warn "build freshness is NOT checked here — confirm one unmistakable artifact from the diff is live in the app before case #1 (qa-test-plan.md §3)"

# =====================================================
# VERDICT — always last on stdout
# =====================================================
echo ""
echo '```qa-env'
if [[ -f "$RUNDIR/results" ]]; then
  sort -t'|' -k1,1n "$RUNDIR/results" | while IFS='|' read -r _ n s d; do
    printf 'CHECK: %-12s %-8s %s\n' "$n" "$s" "$d"
  done
fi
if [[ -f "$RUNDIR/warnings" ]]; then
  while IFS= read -r w; do [[ -n "$w" ]] && echo "WARN: $w"; done <"$RUNDIR/warnings"
fi
if [[ -f "$RUNDIR/causes" ]]; then
  while IFS= read -r c; do
    [[ -z "$c" ]] && continue
    echo "CAUSE: $c"
    case "$c" in
      WEB_NOT_RUNNING) echo "HINT: start it with 'npm run dev' in apps/web, or rerun with --start" ;;
      API_NOT_RUNNING) echo "HINT: start the API (npm --workspace apps/api run build builds it; run it however this project normally does)" ;;
    esac
  done <"$RUNDIR/causes"
fi
if [[ $BLOCKED -eq 0 ]]; then
  echo "VERDICT: READY"
else
  echo "VERDICT: BLOCKED"
fi
echo '```'

exit $BLOCKED
