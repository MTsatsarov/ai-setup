#!/usr/bin/env bash
# =====================================================
# Fixture for protect-plan-artifacts.sh
# =====================================================
#
#   .claude/hooks/test-protect-plan-artifacts.sh
#
# Run this after ANY edit to that hook's patterns. The hook's failure mode is
# silent and inverted: a PreToolUse hook that errors exits 2, which the harness
# reads as BLOCKED. So a broken guard looks exactly like a working one until the
# day it blocks something you needed — and an unquoted `|` inside `[[ =~ ]]` is
# enough to cause it.
#
# The command strings below are assembled from fragments (`G=$(printf 'g''it')`)
# so that running this file does not itself trip the hook watching this
# session's Bash calls.
# =====================================================
set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/protect-plan-artifacts.sh"
[[ -x "$HOOK" ]] || { echo "❌ $HOOK is not executable"; exit 1; }

G=$(printf 'g''it')
PLANS=$(printf 'docs/plans')
QA=$(printf 'docs/qa')
BASE=$(printf 'main')

PASS=0; FAIL=0

expect() {  # expect <blocked|allowed> <command>
  local want="$1" cmd="$2" got rc
  got=$(printf '{"tool_input":{"command":%s}}' "$(printf '%s' "$cmd" | jq -Rs .)" | "$HOOK" 2>/dev/null)
  rc=$?
  local actual="allowed"; [[ $rc -eq 2 ]] && actual="blocked"
  if [[ "$actual" == "$want" ]]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "  ✗ expected $want, got $actual (exit $rc): $cmd"
  fi
}

# --- workflow artifacts -----------------------------------------------------
expect blocked "$G add $PLANS/TASK-1.md"

# --- blanket staging --------------------------------------------------------
# Named nothing, sweeps everything — including the artifacts, which are not
# git-ignored on purpose.
expect blocked "$G add ."
expect blocked "$G add -A"
expect blocked "$G add --all"
expect blocked "$G commit -am wip"
expect blocked "$G commit -a -m wip"
expect blocked "$G stage $QA/report.md"
expect blocked "$G commit -m x -- $PLANS/x.state.json"
expect blocked "$G -C /some/worktree add $PLANS/x.md"
expect blocked "$G --no-pager add $PLANS/x.md"
# Naming the dirs in order to EXCLUDE them is the correct usage.
expect allowed "$G add -A -- ':/' ':(exclude)$PLANS' ':(exclude)$QA'"
expect allowed "$G add src/app.ts"
expect allowed "$G status --porcelain"
expect allowed "ls $PLANS"
expect allowed "cat $PLANS/TASK-1.md"

# --- destructive git --------------------------------------------------------
expect blocked "$G checkout $BASE"
expect blocked "$G checkout -- ."
expect blocked "$G switch $BASE"
expect blocked "$G restore src/app.ts"
expect blocked "$G stash"
expect blocked "$G stash push -m wip"
expect blocked "$G clean -fd"
expect blocked "$G reset --hard HEAD~1"
expect blocked "$G -C /wt checkout $BASE"
expect allowed "$G checkout -b user/TASK-1/thing"
expect allowed "$G switch -c user/TASK-1/thing"
expect allowed "$G reset HEAD~1"
expect allowed "$G revert --no-edit HEAD"

# --- forbidden pushes -------------------------------------------------------
expect blocked "$G push --force"
expect blocked "$G push --force-with-lease origin HEAD"
expect blocked "$G push -f origin HEAD"
expect blocked "$G push origin $BASE"
expect blocked "$G push origin HEAD:$BASE"
expect blocked "$G push origin HEAD:refs/heads/$BASE"

# --- push without a verify PASS ---------------------------------------------
# Run against a throwaway repo that carries its own verify-stamp.sh, so the
# gate applies to it and this fixture never records a stamp in a real repo.
STAMP_SRC="$(cd "$(dirname "$HOOK")/../scripts" && pwd)/verify-stamp.sh"
PUSHREPO=$(mktemp -d "${TMPDIR:-/tmp}/push-fixture.XXXXXX")
trap 'rm -rf "$PUSHREPO"' EXIT
mkdir -p "$PUSHREPO/.claude/scripts"
cp "$STAMP_SRC" "$PUSHREPO/.claude/scripts/verify-stamp.sh"
"$G" -C "$PUSHREPO" init -q .
"$G" -C "$PUSHREPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

expect_in() {  # expect_in <cwd> <blocked|allowed> <command>
  local dir="$1" want="$2" cmd="$3" rc
  jq -n --arg c "$cmd" --arg d "$dir" '{tool_input:{command:$c},cwd:$d}' | "$HOOK" >/dev/null 2>&1
  rc=$?
  local actual="allowed"; [[ $rc -eq 2 ]] && actual="blocked"
  if [[ "$actual" == "$want" ]]; then PASS=$((PASS+1)); else
    FAIL=$((FAIL+1)); echo "  ✗ expected $want, got $actual (exit $rc) in $dir: $cmd"; fi
}

expect_in "$PUSHREPO" blocked "$G push -u origin user/TASK-1/thing"
expect_in /           blocked "cd $PUSHREPO && $G push -u origin user/TASK-1/thing"
expect_in /           blocked "$G -C $PUSHREPO push origin HEAD"
# Deleting a remote branch carries no code.
expect_in "$PUSHREPO" allowed "$G push origin --delete user/TASK-1/thing"

"$STAMP_SRC" record "$PUSHREPO" "$("$STAMP_SRC" head "$PUSHREPO")"
expect_in "$PUSHREPO" allowed "$G push -u origin user/TASK-1/thing"
expect_in "$PUSHREPO" allowed "$G push origin HEAD:refs/heads/user/TASK-1/thing"
expect_in /           allowed "$G -C $PUSHREPO push origin HEAD"

# --- a statement that merely mentions an artifact path ----------------------
# Each guard asks "does THIS command do X to Y". Asking it of a whole blob
# conflates unrelated statements.
expect allowed "echo $PLANS/x.md && $G add src/app.ts"

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "✅ protect-plan-artifacts: $PASS/$PASS cases passed"
  exit 0
fi
echo "❌ protect-plan-artifacts: $FAIL of $((PASS+FAIL)) cases FAILED"
exit 1
