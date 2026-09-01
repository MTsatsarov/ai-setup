#!/usr/bin/env bash
# =====================================================
# statusline.sh — where the current /ship run is
# =====================================================
#
# Renders docs/plans/<ID>.state.json as one line for the Claude Code status
# line. Wire it up with `/statusline`, or in .claude/settings.json:
#
#   "statusLine": { "type": "command", "command": ".claude/scripts/statusline.sh" }
#
# /ship runs one stage per invocation, each in a fresh context, so between stages
# nothing on screen says where the run is. This does — and because the status line
# is UI chrome, its output never enters the conversation, so it costs zero tokens
# no matter how often it refreshes.
#
# CONTRACT: print at most one line, never block, never write to stderr, always
# exit 0. This runs constantly; a status line that errors is worse than one that
# is absent.
# =====================================================
set -uo pipefail

# Every failure path is "print nothing and leave" — never a message, never a
# non-zero exit. There is no useful way for this script to report a problem.
quiet() { exit 0; }

command -v jq >/dev/null 2>&1 || quiet

# --- input --------------------------------------------------------------
# The harness pipes JSON in. Guard on `-t 0` so running this by hand from a
# terminal returns immediately instead of blocking on a read that never ends.
INPUT=""
[[ ! -t 0 ]] && INPUT=$(cat 2>/dev/null || true)

# Field name is taken defensively: if the schema differs from what is expected,
# falling back to $PWD degrades this to "works in the main checkout" rather than
# breaking outright.
CWD=""
if [[ -n "$INPUT" ]]; then
  CWD=$(printf '%s' "$INPUT" \
    | jq -r '.cwd // .workspace.current_dir // .workspace.project_dir // empty' 2>/dev/null || true)
fi
[[ -z "$CWD" || ! -d "$CWD" ]] && CWD="$PWD"

# --- locate the run -----------------------------------------------------
# --git-common-dir is the one path every linked worktree shares, so this finds
# the main checkout even when the status line is rendered inside a /ship worktree
# — which is exactly where you are during stages 2-4.
GIT_COMMON=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || quiet
MAIN=$(dirname "$GIT_COMMON")

# Most recently touched run. `ls -t` on mtime rather than parsing updatedAt out of
# every candidate: same answer, one process instead of N.
STATE=$(ls -t "$MAIN"/docs/plans/*.state.json 2>/dev/null | head -1)
[[ -n "$STATE" && -f "$STATE" ]] || quiet

# --- render -------------------------------------------------------------
# Staleness is computed in jq, not date(1): BSD and GNU date disagree on parsing
# ISO-8601, and this has to work on macOS.
#
# Going quiet after 6h is the difference between an indicator and furniture — a
# finished task would otherwise sit in the status line for days, and a status line
# that is always showing something stops being read.
MAX_AGE=21600

jq -r --argjson maxage "$MAX_AGE" '
  # A malformed or half-written state file renders nothing rather than garbage:
  # plan-state.sh writes via a temp file, but a torn read is still possible.
  def s(f): (f // "" | tostring);

  if (.updatedAt | type) != "string" then empty
  elif ((now - (.updatedAt | fromdateiso8601? // 0)) > $maxage) then empty
  else
    (s(.taskId)) as $key
    | (s(.stage)) as $stage
    | (if (.prNumber | type) == "number" then " #\(.prNumber)" else "" end) as $pr
    | (if $stage == "implementing" then
         " · backend \(.verify.backendAttempts // 0)/3 tests \(.verify.testsAttempts // 0)/3"
       else "" end) as $attempts
    | if   $stage == "planned"      then "\($key) 1/5 planned → implement"
      elif $stage == "implementing" then "\($key) 2/5 implementing\($attempts)"
      elif $stage == "verified"     then "\($key) 2/5 verified → pr"
      elif $stage == "pr-open"      then "\($key) 3/5 pr\($pr) → self-check"
      elif $stage == "self-checked" then "\($key) 4/5 self-checked → report"
      elif $stage == "ready"        then "\($key) 5/5 ready ✓\($pr)"
      elif $stage == "stopped"      then "\($key) ⚠ stopped: \(s(.stop.reason))"
      elif $stage == ""             then empty
      else "\($key) \($stage)"
      end
  end
' "$STATE" 2>/dev/null || quiet

exit 0
