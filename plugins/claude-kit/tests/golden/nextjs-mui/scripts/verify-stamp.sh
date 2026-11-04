#!/usr/bin/env bash
# =====================================================
# verify-stamp.sh — remembers which code verify.sh passed
# =====================================================
#
#   verify-stamp.sh tree   <workdir>          tree hash of the working tree, as pr.sh would commit it
#   verify-stamp.sh head   <workdir>          tree hash of HEAD
#   verify-stamp.sh record <workdir> <tree>   mark <tree> as passed
#   verify-stamp.sh check  <workdir> <tree>   exit 0 if <tree> passed, 1 if not
#
# Safety invariant 3 ("never commit or push on a non-PASS verdict") is
# otherwise prose only. verify.sh records the tree it passed, and pr.sh and the
# push guard in hooks/protect-plan-artifacts.sh refuse any tree that is not on
# the list.
#
# The working tree is hashed the way pr.sh stages it — `git add -A` minus
# docs/plans and docs/qa — into a throwaway copy of the
# index, so the hash names exactly the content a commit would carry and the
# real index is never touched.
#
# A tree hash is a content address. The same code verified in one worktree
# counts in every other one, and any edit made after the run yields a hash that
# was never recorded. The list lives in the common git dir, which all worktrees
# of the repo share.
# =====================================================
set -uo pipefail

CMD="${1:-}"
WD="${2:-.}"
KEEP=500

store() {
  local common
  common=$(git -C "$WD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  printf '%s/nextjs-mui-verified-trees\n' "$common"
}

working_tree() {
  local idx tmp rc
  idx=$(git -C "$WD" rev-parse --path-format=absolute --git-path index 2>/dev/null) || return 1
  tmp=$(mktemp "${TMPDIR:-/tmp}/nextjs-mui-stamp-index.XXXXXX") || return 1
  # git reads an empty file as a corrupt index, so no index at all means no file.
  if [[ -f "$idx" ]]; then cp "$idx" "$tmp"; else rm -f "$tmp"; fi
  GIT_INDEX_FILE="$tmp" git -C "$WD" add -A -- ':/' ':(exclude)docs/plans' ':(exclude)docs/qa' >/dev/null 2>&1 \
    && GIT_INDEX_FILE="$tmp" git -C "$WD" write-tree
  rc=$?
  rm -f "$tmp"
  return $rc
}

case "$CMD" in
  tree)
    working_tree
    ;;
  head)
    git -C "$WD" rev-parse 'HEAD^{tree}'
    ;;
  record)
    TREE="${3:?usage: verify-stamp.sh record <workdir> <tree>}"
    FILE=$(store) || exit 1
    printf '%s\t%s\n' "$TREE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$FILE"
    if [[ $(wc -l <"$FILE") -gt $KEEP ]]; then
      tail -n "$KEEP" "$FILE" >"$FILE.tmp" && mv "$FILE.tmp" "$FILE"
    fi
    ;;
  check)
    TREE="${3:?usage: verify-stamp.sh check <workdir> <tree>}"
    FILE=$(store) || exit 1
    [[ -f "$FILE" ]] || exit 1
    awk -F'\t' -v t="$TREE" '$1 == t { found = 1 } END { exit found ? 0 : 1 }' "$FILE"
    ;;
  *)
    echo "usage: verify-stamp.sh tree|head|record|check <workdir> [tree]" >&2
    exit 2
    ;;
esac
