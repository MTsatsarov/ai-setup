#!/usr/bin/env bash
# =====================================================
# plan-state.sh — workflow handoff state for a React MUI task
# =====================================================
#
#   plan-state.sh <task-id|--branch> show
#   plan-state.sh <task-id|--branch> path
#   plan-state.sh <task-id|--branch> get <field>
#   plan-state.sh <task-id|--branch> set <field>=<value> [<field>=<value> ...]
#
# <task-id> is a ClickUp task id (e.g. 86abc12) — 6-12 lowercase alphanumerics.
#
# State lives at <main-checkout>/docs/plans/<ID>.state.json — always
# the main checkout, even when called from a linked worktree (see ROOT below).
#
# It exists so each workflow stage can hand values to the next without a human
# retyping them, and — the reason it is not optional — so that a bounded loop's
# attempt counter SURVIVES A CONTEXT COMPACT. A counter held only in the model's
# head silently resets to a fresh 3 attempts when the conversation compacts,
# which is precisely the runaway a bounded loop exists to prevent.
#
# Fields may be dotted for nesting:  verify.verdict=PASS  verify.backendAttempts=2
# Integers and true/false are written as JSON scalars, everything else as strings.
#
#   --branch  derives the id from segment 2 of the current branch name —
#             {user}/{task-id}/{name} or {user}/{slug}
#
# `get` on a missing file or field prints nothing and exits 0, so callers can do:
#     N=$(plan-state.sh --branch get verify.backendAttempts)
#     [[ -z "$N" ]] && N=0
# =====================================================
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required by plan-state.sh" >&2
  exit 1
fi

# The state file always lives in the MAIN checkout, never in a linked worktree.
# `--git-common-dir` is the one path every linked worktree shares: it always
# points at the main repo's .git, so its parent is the main checkout. In the main
# checkout itself it degrades to `.git`, i.e. exactly the plain behaviour.
#
# This matters even in a project with no worktree workflow today: it costs
# nothing here and is the single thing that would otherwise silently break every
# artifact path the day one is added. A state file written inside a task
# worktree is destroyed by `git worktree remove --force`, taking the attempt
# counters and the stop record's pointer with it.
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
  echo "❌ not inside a git repository" >&2; exit 1; }
ROOT=$(dirname "$GIT_COMMON")

if [[ $# -lt 1 ]]; then
  echo "usage: plan-state.sh <task-id|--branch> [show|path|get <field>|set <k>=<v>...]" >&2
  exit 2
fi

KEY_ARG="$1"; shift
if [[ "$KEY_ARG" == "--branch" ]]; then
  # Deliberately NOT `git -C "$ROOT"`: the id comes from the branch checked out
  # *here*, which in a worktree is the task branch, not whatever main has out.
  BRANCH=$(git branch --show-current 2>/dev/null)
  # Segment 2 is the id under both conventions: {user}/{task-id}/{name} for a
  # tracked task, and {user}/{slug} for an untracked one.
  KEY=$(printf '%s\n' "$BRANCH" | awk -F/ 'NF>=2 {print $2}')
  if [[ -z "$KEY" ]]; then
    echo "❌ could not derive a task id from branch '$BRANCH'" >&2
    echo "   expected {github_user}/{task-id}/{name} or {github_user}/{slug}," >&2
    echo "   e.g. <github-user>/86abc12/short-name" >&2
    echo "   pass the id explicitly instead: plan-state.sh 86abc12 ..." >&2
    exit 1
  fi
else
  KEY="$KEY_ARG"
fi

# The id is a ClickUp task id (e.g. 86abc12) — 6-12 lowercase alphanumerics. It also becomes a FILENAME below, so
# the pattern is deliberately strict — no spaces, no `/` or `..` (path
# traversal), one canonical spelling per task. Two spellings means two state
# files, and a loop that silently loses its attempt counters between stages.
if [[ ! "$KEY" =~ ^[a-z0-9]{6,12}$ || ${#KEY} -gt 50 ]]; then
  echo "❌ '$KEY' is not a valid task id" >&2
  echo "   expected a ClickUp task id (e.g. 86abc12) — 6-12 lowercase alphanumerics, 50 chars max" >&2
  exit 1
fi

FILE="$ROOT/docs/plans/$KEY.state.json"
ACTION="${1:-show}"; [[ $# -gt 0 ]] && shift

case "$ACTION" in

  path) echo "$FILE" ;;

  show)
    if [[ -f "$FILE" ]]; then cat "$FILE"; else echo "{}"; fi
    ;;

  get)
    [[ $# -lt 1 ]] && { echo "❌ get needs a field name" >&2; exit 2; }
    [[ -f "$FILE" ]] || exit 0
    jq -r --arg p "$1" 'getpath($p | split(".")) // empty' "$FILE" 2>/dev/null || true
    ;;

  set)
    [[ $# -lt 1 ]] && { echo "❌ set needs at least one <field>=<value>" >&2; exit 2; }
    mkdir -p "$(dirname "$FILE")"

    # Known fields. `get` on an unknown field prints nothing and exits 0 by
    # design, so callers can fall back cleanly — but that also means a typo on
    # `set` (verify.result instead of verify.verdict) is completely silent: the
    # write succeeds, the read returns empty, and the caller quietly takes its
    # fallback path. Warn on write, where the typo actually is.
    #
    # A warning, not an error: this list is documentation that drifts, and a
    # hard failure here would block a stage over a spelling difference.
    #
    # Generated from the stages and areas this project actually has, so it
    # carries no fields nothing writes.
    KNOWN="taskId mainRoot branchSlug branchName baseRefName worktree baseline
           prNumber prUrl isDraft stage updatedAt
           verify stop report qa selfCheck watch clickup"
    if [[ ! -f "$FILE" ]]; then
      jq -n --arg k "$KEY" '{taskId: $k}' > "$FILE"
    fi

    for kv in "$@"; do
      if [[ "$kv" != *=* ]]; then
        echo "❌ '$kv' is not <field>=<value>" >&2; exit 2
      fi
      k="${kv%%=*}"; v="${kv#*=}"

      top="${k%%.*}"
      case " $(echo $KNOWN) " in
        *" $top "*) ;;
        *) echo "⚠ plan-state: '$top' is not a known field — typo? (see the state schema in .claude/README.md)" >&2 ;;
      esac

      TMP=$(mktemp)
      if [[ "$v" =~ ^-?[0-9]+$ || "$v" == "true" || "$v" == "false" || "$v" == "null" ]]; then
        jq --arg p "$k" --argjson v "$v" 'setpath($p | split("."); $v)' "$FILE" > "$TMP"
      else
        jq --arg p "$k" --arg  v "$v" 'setpath($p | split("."); $v)' "$FILE" > "$TMP"
      fi
      if [[ -s "$TMP" ]]; then mv "$TMP" "$FILE"; else rm -f "$TMP"; echo "❌ failed to set $k" >&2; exit 1; fi
    done

    TMP=$(mktemp)
    jq '.updatedAt = (now | todate)' "$FILE" > "$TMP" && mv "$TMP" "$FILE"
    ;;

  *)
    echo "❌ unknown action '$ACTION' (expected show|path|get|set)" >&2
    exit 2
    ;;
esac
