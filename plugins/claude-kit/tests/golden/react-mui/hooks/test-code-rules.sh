#!/usr/bin/env bash
# =====================================================
# Fixture for code-rules.sh
# =====================================================
#
#   .claude/hooks/test-code-rules.sh
#
# Run this after ANY edit to that hook's rules. Every rule is replayed through
# the real hook with its own sample path and a bad and a good line, in a
# throwaway git repository — never in this one.
#
# Per rule, four cases:
#   Write a new file with the bad line       → blocked
#   Write a new file with the good line      → allowed
#   Edit a file that already has the bad line, without adding one → allowed
#   Edit that adds a second bad line         → blocked
# and then the --diff mode once over all of them.
#
# The failure mode this guards is silent: an ERE that matches nothing blocks
# nothing, and looks exactly like a codebase with no violations.
# =====================================================
set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/code-rules.sh"
[[ -x "$HOOK" ]] || { echo "❌ $HOOK is not executable"; exit 1; }

REPO=$(mktemp -d "${TMPDIR:-/tmp}/code-rules-fixture.XXXXXX")
trap 'rm -rf "$REPO"' EXIT
REPO=$(cd "$REPO" && pwd -P)
git -C "$REPO" init -q . && git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

# run_hook <json> — prints "blocked" or "allowed"
run_hook() {
  "$HOOK" <<<"$1" >/dev/null 2>&1
  [[ $? -eq 2 ]] && echo blocked || echo allowed
}

write_json() {  # write_json <path> <content>
  jq -n --arg p "$1" --arg c "$2" '{tool_name:"Write",tool_input:{file_path:$p,content:$c}}'
}
edit_json() {   # edit_json <path> <old> <new>
  jq -n --arg p "$1" --arg o "$2" --arg n "$3" '{tool_name:"Edit",tool_input:{file_path:$p,old_string:$o,new_string:$n}}'
}

# expect <want> <label> <json>
expect() {
  local got; got=$(run_hook "$3")
  if [[ "$got" == "$1" ]]; then ok; else bad "$2: expected $1, got $got"; fi
}

case_rule() {  # case_rule <id> <sample> <bad line> <good line>
  local id="$1" f="$REPO/$2" badl="$3" goodl="$4"
  mkdir -p "$(dirname "$f")"
  rm -f "$f"
  expect blocked "$id: Write with the bad line"  "$(write_json "$f" "$badl")"
  expect allowed "$id: Write with the good line" "$(write_json "$f" "$goodl")"
  printf '%s\nkeep\n' "$badl" >"$f"
  expect allowed "$id: Edit beside an existing violation" "$(edit_json "$f" keep kept)"
  expect blocked "$id: Edit that adds a violation" "$(edit_json "$f" keep "keep"$'\n'"$badl")"
  rm -f "$f"
}

case_rule 'backend-ts-suppress' 'apps/api/src/feature/feature.service.ts' '// @ts-ignore' 'const total = items.length;'
case_rule 'backend-any' 'apps/api/src/feature/feature.service.ts' 'const value: any = load();' 'const value: unknown = load();'
case_rule 'backend-as-unknown-as' 'apps/api/src/feature/feature.service.ts' 'const user = raw as unknown as User;' 'const user = parseUser(raw);'
case_rule 'backend-focused-test' 'apps/api/src/feature/feature.service.spec.ts' 'it.skip('\''loads'\'', () => {});' 'it('\''loads'\'', () => {});'
case_rule 'frontend-ts-suppress' 'apps/web/src/lib/feature.ts' '// @ts-ignore' 'const total = items.length;'
case_rule 'frontend-any' 'apps/web/src/lib/feature.ts' 'const value: any = load();' 'const value: unknown = load();'
case_rule 'frontend-as-unknown-as' 'apps/web/src/lib/feature.ts' 'const user = raw as unknown as User;' 'const user = parseUser(raw);'
case_rule 'frontend-focused-test' 'apps/web/src/lib/feature.test.ts' 'it.skip('\''loads'\'', () => {});' 'it('\''loads'\'', () => {});'
case_rule 'ui-raw-button' 'apps/web/src/components/FeatureForm.tsx' '<button onClick={save}>Save</button>' '<Button onClick={save}>Save</Button>'

# --- outside every rule ----------------------------------------------------
expect allowed "a path no rule includes" "$(write_json "$REPO/notes/readme.txt" '// @ts-ignore')"
expect allowed "a path outside any git repo" "$(write_json "/nonexistent-claude-kit/x.ts" 'anything')"

# --- --diff over the branch ---------------------------------------------------
write_sample() {  # write_sample <sample> <line>
  mkdir -p "$(dirname "$REPO/$1")"; printf '%s\n' "$2" >"$REPO/$1"
}
write_sample 'apps/api/src/feature/feature.service.ts' '// @ts-ignore'
write_sample 'apps/api/src/feature/feature.service.ts' 'const value: any = load();'
write_sample 'apps/api/src/feature/feature.service.ts' 'const user = raw as unknown as User;'
write_sample 'apps/api/src/feature/feature.service.spec.ts' 'it.skip('\''loads'\'', () => {});'
write_sample 'apps/web/src/lib/feature.ts' '// @ts-ignore'
write_sample 'apps/web/src/lib/feature.ts' 'const value: any = load();'
write_sample 'apps/web/src/lib/feature.ts' 'const user = raw as unknown as User;'
write_sample 'apps/web/src/lib/feature.test.ts' 'it.skip('\''loads'\'', () => {});'
write_sample 'apps/web/src/components/FeatureForm.tsx' '<button onClick={save}>Save</button>'
if "$HOOK" --diff "$REPO" >/dev/null 2>&1; then bad "--diff: passed a branch full of violations"; else ok; fi
write_sample 'apps/api/src/feature/feature.service.ts' 'const total = items.length;'
write_sample 'apps/api/src/feature/feature.service.ts' 'const value: unknown = load();'
write_sample 'apps/api/src/feature/feature.service.ts' 'const user = parseUser(raw);'
write_sample 'apps/api/src/feature/feature.service.spec.ts' 'it('\''loads'\'', () => {});'
write_sample 'apps/web/src/lib/feature.ts' 'const total = items.length;'
write_sample 'apps/web/src/lib/feature.ts' 'const value: unknown = load();'
write_sample 'apps/web/src/lib/feature.ts' 'const user = parseUser(raw);'
write_sample 'apps/web/src/lib/feature.test.ts' 'it('\''loads'\'', () => {});'
write_sample 'apps/web/src/components/FeatureForm.tsx' '<Button onClick={save}>Save</Button>'
if OUT=$("$HOOK" --diff "$REPO" 2>&1); then ok; else bad "--diff: failed a clean branch"$'\n'"$OUT"; fi

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "✅ code-rules: $PASS/$PASS cases passed"
  exit 0
fi
echo "❌ code-rules: $FAIL of $((PASS+FAIL)) cases FAILED"
exit 1
