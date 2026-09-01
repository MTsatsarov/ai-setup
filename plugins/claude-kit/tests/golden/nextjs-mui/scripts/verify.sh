#!/usr/bin/env bash
# =====================================================
# verify.sh — deterministic verification for Nextjs MUI
# =====================================================
#
#   verify.sh [tier] [scope] [workdir]
#
#     tier    quick | tests | full | integration   (default: quick)
#     scope   auto | backend | tests | frontend | all | none   (default: auto)
#     workdir repo root to verify                  (default: current repo toplevel)
#
# Prints a machine-readable verdict block as the LAST thing on stdout and exits
# 0 (PASS) or 1 (FAIL). Full output goes to a log file whose path is printed;
# only failing lines are echoed inline, so logs never flood the caller's context
# on the happy path.
#
# THIS SCRIPT IS THE ONLY THING ALLOWED TO DECIDE WHETHER A CHANGE WORKS.
# Every workflow skill defers to its verdict, which is what makes "verified"
# mean exactly one thing everywhere in the chain. Do not run the underlying
# build/lint/test commands by hand and judge the output yourself — that is how
# two callers end up with two different definitions of green.
#
# Deliberately NOT `set -e`: every step must run so the verdict lists them all.
# A gate that stops at the first failure reports one problem per run, which
# turns a three-error change into three round trips.
#
# TIERS ARE NOT CUMULATIVE. `tests` deliberately skips the compile-only legs of
# the other areas so the test writer's inner loop stays fast; `integration` is
# opt-in and must never be placed inside a retry loop.
# =====================================================
set -uo pipefail

TIER="${1:-quick}"
SCOPE="${2:-auto}"
WORKDIR="${3:-}"

case "$TIER" in
  quick|tests|full|integration) ;;
  *) echo "❌ unknown tier '$TIER' (expected quick|tests|full|integration)" >&2; exit 2 ;;
esac

# Scope may be a single keyword or a comma-separated combination, so a caller
# that already knows two sides changed can verify both in one run.
case "$SCOPE" in
  auto|all|none) ;;
  *)
    IFS=',' read -ra _SCOPE_PARTS <<< "$SCOPE"
    for _p in "${_SCOPE_PARTS[@]}"; do
      case "$_p" in
        backend|tests|frontend) ;;
        *) echo "❌ unknown scope '$_p' (expected auto|backend|tests|frontend|all|none, or a comma-separated combination)" >&2; exit 2 ;;
      esac
    done ;;
esac

if [[ -z "$WORKDIR" ]]; then
  WORKDIR=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "❌ not inside a git repository and no workdir given" >&2; exit 2; }
fi
cd "$WORKDIR" || { echo "❌ cannot cd to $WORKDIR" >&2; exit 2; }

RUNDIR=$(mktemp -d -t nextjs-mui-verify)
LOG="$RUNDIR/verify.log"
trap 'rm -rf "$RUNDIR"' EXIT

# =====================================================
# SCOPE DETECTION
# =====================================================
# In a normal checkout the working-tree status is the change. On a clean tree
# (a reviewed branch, a detached worktree) there is no status delta, so fall
# back to the diff vs the merge-base with the base branch.
#
# `-uall` is load-bearing: without it a new directory collapses to a single
# entry and every file inside it is silently absent from the scope.
changed_files() {
  local out base
  out=$(git status --porcelain -uall 2>/dev/null | awk '{print $NF}')
  if [[ -z "$out" ]]; then
    base=$(git merge-base HEAD origin/main 2>/dev/null || true)
    [[ -n "$base" ]] && out=$(git diff --name-only "$base"...HEAD 2>/dev/null || true)
  fi
  printf '%s\n' "$out"
}

CHANGED=$(changed_files)

# Areas may overlap on purpose — a changed test file belongs to `tests` for
# routing and still needs the backend leg to compile.
if [[ "$SCOPE" == "auto" ]]; then
  SCOPE=""
  printf '%s\n' "$CHANGED" | grep -qE '^apps/api/' && SCOPE="${SCOPE:+$SCOPE,}backend"
  printf '%s\n' "$CHANGED" | grep -qE '(^apps/api/test/|\.spec\.ts$|\.e2e-spec\.ts$)' && SCOPE="${SCOPE:+$SCOPE,}tests"
  printf '%s\n' "$CHANGED" | grep -qE '^apps/web/' && SCOPE="${SCOPE:+$SCOPE,}frontend"
  [[ -z "$SCOPE" ]] && SCOPE="none"
elif [[ "$SCOPE" == "all" ]]; then
  SCOPE="backend,tests,frontend"
fi

run_backend=0; [[ "$SCOPE" == *backend* ]] && run_backend=1
run_frontend=0; [[ "$SCOPE" == *frontend* ]] && run_frontend=1
run_tests=0; [[ "$SCOPE" == *tests* ]] && run_tests=1

# =====================================================
# STEP RUNNER
# =====================================================
# step <sort-index> <name> <cmd...>
#
# The sort index fixes this step's position in the verdict block regardless of
# the order the parallel legs actually finish in — without it the block would
# reorder run to run and stop being diffable.
ERR_RE='error TS[0-9]+|✕|^FAIL |Tests: .*failed|npm ERR|Cannot find module|✖|Failed to compile'

step() {
  local idx="$1" name="$2"; shift 2
  local t0=$SECONDS
  local slog="$RUNDIR/$idx-$name.log"
  echo "▶ $name" >&2
  {
    echo "======================================================"
    echo "STEP: $name  ::  $*"
    echo "======================================================"
  } >"$slog"
  if "$@" >>"$slog" 2>&1; then
    printf '%s|%s|PASS|%ss\n' "$idx" "$name" "$((SECONDS-t0))" >>"$RUNDIR/results"
  else
    printf '%s|%s|FAIL|%ss\n' "$idx" "$name" "$((SECONDS-t0))" >>"$RUNDIR/results"
    # Only this step's log — a shared log would replay every earlier failure too.
    {
      echo "--- $name FAILED — matching lines from its log ---"
      grep -E "$ERR_RE" "$slog" | tail -40 || tail -25 "$slog"
    } >&2
  fi
}

# A warning never flips the verdict. A false FAIL would burn all three of the
# caller's fix attempts chasing a non-problem, which is strictly worse than a
# line of advice it can ignore.
warn() { printf '%s\n' "$1" >>"$RUNDIR/warnings"; }

runs_at_tier() {  # runs_at_tier "<space-separated tiers>"
  case " $1 " in *" $TIER "*) return 0 ;; *) return 1 ;; esac
}

# =====================================================
# LEGS
# =====================================================

leg_backend() {
  runs_at_tier "quick tests full integration" && step 10 "backend-build" bash -c 'npm --workspace apps/api run build'
  :
}

leg_frontend() {
  runs_at_tier "quick full integration" && step 20 "frontend-lint" bash -c 'npm --prefix apps/web run lint'
  runs_at_tier "quick full integration" && step 21 "frontend-build" bash -c 'npm --prefix apps/web run build'
  :
}

leg_tests() {
  runs_at_tier "tests full integration" && step 40 "backend-test" bash -c 'npm --workspace apps/api run test -- --passWithNoTests=false'
  :
}

# =====================================================
# GUARDS — heuristics, reported as WARN and never as a verdict
# =====================================================
guards() {
  if printf '%s\n' "$CHANGED" | grep -qE '^apps/api/src/db/schema/' \
     && ! printf '%s\n' "$CHANGED" | grep -qE '^apps/api/drizzle/.*\.sql$'; then
    warn "migration-guard: src/db/schema changed but no new .sql under apps/api/drizzle/ — run 'npx drizzle-kit generate' (see the backend-migrations skill)"
  fi
  :
}

guards

# Phase A runs every leg that does not own tests, concurrently: they share no
# build output and each step is a single mostly-single-threaded process.
LEG_PIDS=()
[[ $run_backend -eq 1 ]] && { leg_backend & LEG_PIDS+=($!); }
[[ $run_frontend -eq 1 ]] && { leg_frontend & LEG_PIDS+=($!); }
# Guarded rather than "${LEG_PIDS[@]:-}": under `set -u` an empty array expansion
# is an error on bash 3.2, which is what /bin/bash still is on macOS.
if [[ ${#LEG_PIDS[@]} -gt 0 ]]; then
  for pid in "${LEG_PIDS[@]}"; do wait "$pid"; done
fi

# Phase B — tests, serially and after the builds. Test runners already fan out
# across cores internally, so running suites concurrently oversubscribes the
# machine and finishes slower while interleaving their output.
[[ $run_tests -eq 1 ]] && leg_tests

# =====================================================
# MERGE
# =====================================================
RESULTS=""
[[ -f "$RUNDIR/results" ]] && RESULTS=$(sort -t'|' -k1,1n "$RUNDIR/results")

WARNINGS=""
[[ -f "$RUNDIR/warnings" ]] && WARNINGS=$(cat "$RUNDIR/warnings")

FAILED=0
printf '%s\n' "$RESULTS" | grep -q '|FAIL|' && FAILED=1

# One merged log, steps in verdict order — the `LOG:` line stays a single path.
: >"$LOG"
while IFS= read -r f; do
  [[ -f "$f" ]] && cat "$f" >>"$LOG"
done < <(find "$RUNDIR" -maxdepth 1 -name '*.log' ! -name verify.log | sort)

# =====================================================
# NO-RETRY CLASSIFIERS
# =====================================================
# Each of these is a failure the loop must NOT hand to an agent: repairing the
# symptom damages correct code. They are reported as a CAUSE, which every
# workflow skill reads as "stop, and do not spend a fix attempt".
CAUSE_ID=""

# =====================================================
# VERDICT — always last on stdout
# =====================================================
# On PASS the log is noise: nothing failed, so nobody opens it, and the files
# accumulate in $TMPDIR forever. Keep it only when it can still be read.
KEEP_LOG=""
if [[ $FAILED -eq 1 ]]; then
  KEEP_LOG=$(mktemp -t nextjs-mui-verify)
  cp "$LOG" "$KEEP_LOG"
fi

echo ""
echo '```verify'
echo "SCOPE: $SCOPE"
echo "TIER: $TIER"
echo "WORKDIR: $WORKDIR"
if [[ -z "$RESULTS" ]]; then
  echo "STEP: (nothing to verify — no changes detected in any known area)"
else
  printf '%s\n' "$RESULTS" | while IFS='|' read -r _ n s d; do
    [[ -n "$n" ]] && printf 'STEP: %-26s %-4s %s\n' "$n" "$s" "$d"
  done
fi
if [[ -n "$WARNINGS" ]]; then
  printf '%s\n' "$WARNINGS" | while IFS= read -r w; do
    [[ -n "$w" ]] && echo "WARN: $w"
  done
fi

if [[ $FAILED -eq 0 ]]; then
  echo "VERDICT: PASS"
  echo "LOG: (removed — nothing failed)"
else
  echo "VERDICT: FAIL"
  echo "LOG: $KEEP_LOG"
fi
echo '```'

exit $FAILED
