#!/usr/bin/env bash
# Generate a payload into a throwaway sandbox and show you what came out.
# Nothing is written outside the sandbox.
#
#   tests/try.sh                      use the nextjs-shadcn fixture
#   tests/try.sh <fixture-name>       use tests/fixtures/<name>.answers.json
#   tests/try.sh --keep               print the path and leave it on disk
set -euo pipefail

cd "$(dirname "$0")/.."
KIT=$(pwd)

FIXTURE=nextjs-shadcn
KEEP=0
for a in "$@"; do
  case "$a" in
    --keep) KEEP=1 ;;
    *) FIXTURE="$a" ;;
  esac
done

SRC="tests/fixtures/${FIXTURE}.answers.json"
[ -f "$SRC" ] || { echo "no such fixture: $SRC"; ls tests/fixtures/; exit 1; }

SANDBOX=$(mktemp -d)
mkdir -p "$SANDBOX/.claude-kit"
cp "$SRC" "$SANDBOX/.claude-kit/answers.json"

node "$KIT/scripts/resolve.mjs" --answers "$SANDBOX/.claude-kit/answers.json" --out "$SANDBOX/.claude-kit/plan.json"
echo
node "$KIT/scripts/render.mjs" --plan "$SANDBOX/.claude-kit/plan.json" --out "$SANDBOX/.claude"

echo
echo "── hooks actually run ─────────────────────────────────────────"
run_hook() {
  local desc=$1 hook=$2 path=$3 want=$4
  set +e
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$path" | "$SANDBOX/.claude/hooks/$hook.sh" 2>&1)
  code=$?
  set -e
  if [ "$code" = "$want" ]; then
    printf '  \033[32mok\033[0m   %s (exit %s)\n' "$desc" "$code"
  else
    printf '  \033[31mFAIL\033[0m %s — wanted exit %s, got %s\n' "$desc" "$want" "$code"
  fi
  [ -n "$out" ] && echo "       $out"
  return 0
}
run_hook "blocks a migration edit"      protect-migrations      /r/apps/api/drizzle/0001_x.sql        2
run_hook "allows normal source"         protect-migrations      /r/apps/api/src/x/x.service.ts        0
run_hook "blocks a generated snapshot"  protect-generated-files /r/apps/api/drizzle/meta/_journal.json 2

echo
echo "── generated CLAUDE.md ────────────────────────────────────────"
sed -n '1,/^### Skills/p' "$SANDBOX/.claude/CLAUDE.md"

if [ "$KEEP" = 1 ]; then
  echo
  echo "sandbox kept at: $SANDBOX"
  echo "  open it:  cd $SANDBOX && ls -R .claude"
else
  rm -rf "$SANDBOX"
  echo
  echo "sandbox removed (pass --keep to inspect it)"
fi
