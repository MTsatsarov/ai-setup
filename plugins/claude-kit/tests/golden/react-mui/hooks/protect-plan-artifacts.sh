#!/bin/bash
# Blocks any attempt to stage or commit workflow artifacts, run destructive git,
# or push in a way the workflow forbids.
#
# docs/plans/ holds plans, fix plans, stop records, run reports and
# *.state.json; docs/qa/ holds QA reports and evidence. They are
# working artifacts, never part of a feature commit. In the repo this was ported
# from that rule lived only as an advisory line in a skill, and plan files were
# repeatedly swept into feature PRs by a `git add -A`.
#
# Also blocks destructive git: a working tree mid-run carries uncommitted work
# that exists nowhere else, so an unattended checkout/restore/stash/clean loses
# it permanently.
#
# These are Loop Safety Invariants 1, 2 and 5 — see
# .claude/skills/shared/safety-invariants.md, which is the canonical list. This
# hook is the only mechanical enforcement any of them have.
#
# Run the fixture after ANY edit to the patterns below:
#   .claude/hooks/test-protect-plan-artifacts.sh
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

[[ -z "$CMD" ]] && exit 0

# =====================================================
# NORMALISE
# =====================================================
# Every pattern below matches `git` immediately followed by its subcommand. Git
# accepts global options in between, and `git -C <path> <subcommand>` is the
# normal way to drive a worktree — pr-review-pipeline.md teaches exactly that
# form. Before this normalisation, `git -C /wt checkout development` and
# `git -C /wt add docs/plans/x.md` both sailed through every guard here, which
# left Loop Safety Invariants 1 and 2 unenforced on the paths that run
# unattended.
#
# Collapse `git <global-opt> [value]` down to a bare `git` until nothing changes,
# so the subcommand ends up adjacent regardless of how many options precede it.
normalize_git() {
  local s="$1" prev=""
  while [[ "$s" != "$prev" ]]; do
    prev="$s"
    # global options that consume a value, as `--opt value` or `--opt=value`
    s=$(printf '%s' "$s" | sed -E \
      's/(^|[^[:alnum:]_.-])git[[:space:]]+(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)([[:space:]]+|=)[^[:space:]]+/\1git/g')
    # boolean global options
    s=$(printf '%s' "$s" | sed -E \
      's/(^|[^[:alnum:]_.-])git[[:space:]]+(-P|--no-pager|--paginate|--bare|--literal-pathspecs|--icase-pathspecs|--no-replace-objects|--no-optional-locks)([[:space:]])/\1git\3/g')
  done
  printf '%s' "$s"
}

NORM=$(normalize_git "$CMD")

# =====================================================
# SPLIT INTO STATEMENTS
# =====================================================
# Every guard below asks "does THIS command do X to Y", and asking it of the
# whole blob conflates unrelated statements: a script that runs `git add file.ts`
# on one line and merely mentions docs/plans on another was blocked, because both
# strings appeared somewhere in the same tool call. Splitting on shell statement
# separators keeps each check scoped to one command.
#
# Newlines are separators too — a heredoc body would be split as well, but a
# heredoc that contains a destructive git command is not something to wave
# through on a technicality.
STATEMENTS=$(printf '%s' "$NORM" | tr '\n;&|' '\n\n\n\n')

# =====================================================
# WORKFLOW ARTIFACTS
# =====================================================
# Strip `:(exclude)…` pathspec segments first: mentioning the artifact dirs in
# order to EXCLUDE them is the correct usage, and blocking that would block the
# very fix that keeps artifacts out of commits.
ARTIFACT_RE='docs/plans|docs/qa'

while IFS= read -r S; do
  [[ -z "${S// }" ]] && continue
  CHECK=$(printf '%s' "$S" | sed -e "s/'*:(exclude)[^' ]*'*//g")
  if [[ "$CHECK" =~ git[[:space:]]+(add|stage|commit) ]] && [[ "$CHECK" =~ $ARTIFACT_RE ]]; then
    echo "BLOCKED: docs/plans/ and docs/qa/ are working artifacts — never stage or commit them." >&2
    echo "         They stay visible in git status on purpose; keep them out of the index." >&2
    echo "         Offending statement: $S" >&2
    exit 2
  fi
done <<< "$STATEMENTS"

# =====================================================
# BLANKET STAGING
# =====================================================
# The artifact dirs are deliberately NOT git-ignored, so that they stay visible
# in `git status` and keeping them out of the index is an active decision rather
# than something git does silently. The direct consequence is that `git add -A`
# stages them, which is exactly how plan files reached feature PRs in the repo
# this was ported from.
#
# The guard above only fires when a command NAMES an artifact path. A blanket
# stage names nothing and sweeps everything, so it needs its own rule.
RE_BLANKET='git[[:space:]]+(add|stage)[[:space:]]+[^;]*(-A|--all|\.)([[:space:]]|$)'
RE_COMMIT_ALL='git[[:space:]]+commit[^;]*[[:space:]](-a|-am|-ma|--all)([[:space:]]|$)'

while IFS= read -r S; do
  [[ -z "${S// }" ]] && continue
  # An explicit exclude pathspec is the correct way to do this, and is allowed.
  [[ "$S" == *'(exclude)'* ]] && continue
  if [[ "$S" =~ $RE_BLANKET ]] || [[ "$S" =~ $RE_COMMIT_ALL ]]; then
    echo "BLOCKED: a blanket stage sweeps in docs/plans/ and docs/qa/," >&2
    echo "         which are working artifacts and are deliberately not git-ignored." >&2
    echo "         Stage the files you meant by name, or exclude the artifacts:" >&2
    echo "           git add -A -- ':/' ':(exclude)docs/plans' ':(exclude)docs/qa'" >&2
    echo "         Offending statement: $S" >&2
    exit 2
  fi
done <<< "$STATEMENTS"

# =====================================================
# DESTRUCTIVE GIT ON A TREE WITH WIP
# =====================================================
# Branch creation is fine and is used by the normal flow, so `git checkout -b`
# and `git switch -c` are explicitly allowed; only the forms that discard
# working-tree changes are blocked.
while IFS= read -r S; do
  [[ -z "${S// }" ]] && continue
  DESTRUCTIVE=""
  if   [[ "$S" =~ git[[:space:]]+checkout ]] && [[ ! "$S" =~ git[[:space:]]+checkout[[:space:]]+-b ]]; then
    DESTRUCTIVE="git checkout (without -b)"
  elif [[ "$S" =~ git[[:space:]]+switch ]] && [[ ! "$S" =~ git[[:space:]]+switch[[:space:]]+-c ]]; then
    DESTRUCTIVE="git switch (without -c)"
  elif [[ "$S" =~ git[[:space:]]+(restore|stash|clean)([[:space:]]|$) ]]; then
    DESTRUCTIVE="git restore/stash/clean"
  elif [[ "$S" =~ git[[:space:]]+reset[[:space:]]+--hard ]]; then
    DESTRUCTIVE="git reset --hard"
  fi
  if [[ -n "$DESTRUCTIVE" ]]; then
    echo "BLOCKED: $DESTRUCTIVE discards working-tree changes, and a run in progress carries" >&2
    echo "         uncommitted work that exists nowhere else. To undo an edit, revert it" >&2
    echo "         with the Edit tool instead." >&2
    echo "         Allowed: git checkout -b / git switch -c (branch creation)." >&2
    echo "         Offending statement: $S" >&2
    exit 2
  fi
done <<< "$STATEMENTS"

# =====================================================
# FORBIDDEN PUSHES
# =====================================================
# "Never force-push, never push to the base branch" is a Loop Safety Invariant
# that otherwise lives only in prose. An unattended run is exactly where a
# rewritten remote branch is unrecoverable.
#
# The patterns live in variables on purpose: inside `[[ =~ ]]` bash parses an
# unquoted `|` or `;` as shell syntax before the regex engine ever sees it, and
# the resulting error exits 2 — which a PreToolUse hook reads as "blocked". A
# broken guard that blocks everything looks identical to a working one until it
# blocks something you needed. The fixture catches exactly this.
RE_PUSH='git[[:space:]]+push'
RE_FORCE='(--force|--force-with-lease|--force-if-includes|[[:space:]]-f([[:space:]]|$))'
RE_BASE='git[[:space:]]+push[[:space:]][^;]*(origin[[:space:]]+main([[:space:]]|$)|HEAD:(refs/heads/)?main([[:space:]]|$))'

while IFS= read -r S; do
  [[ -z "${S// }" ]] && continue
  [[ "$S" =~ $RE_PUSH ]] || continue
  if [[ "$S" =~ $RE_FORCE ]]; then
    echo "BLOCKED: force-push. A branch under review may have commits you did not fetch," >&2
    echo "         and an unattended rewrite of a remote branch is unrecoverable." >&2
    echo "         Offending statement: $S" >&2
    exit 2
  fi
  if [[ "$S" =~ $RE_BASE ]]; then
    echo "BLOCKED: direct push to main. Changes reach a base branch through a PR." >&2
    echo "         Offending statement: $S" >&2
    exit 2
  fi
done <<< "$STATEMENTS"

exit 0
