#!/usr/bin/env bash
# Full test suite. Renders every fixture into a temp dir and diffs against the
# committed golden tree, so any library edit that changes generated output
# shows up as a reviewable diff rather than a surprise in someone's repo.
#
#   tests/run.sh              run everything
#   tests/update-golden.sh    accept the current output as the new golden
set -uo pipefail

cd "$(dirname "$0")/.."
FAILED=0

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }

# --- 1. engine unit checks ---------------------------------------------------
step "erb engine"
if node tests/erb.test.mjs; then pass "grammar + failure modes"; else fail "erb engine"; fi

# --- 2. library integrity + full cross-product -------------------------------
step "library"
if node scripts/validate-library.mjs; then pass "structure + combinations"; else fail "library"; fi

# --- 3. golden render per fixture --------------------------------------------
step "golden render"
for fixture in tests/fixtures/*.answers.json; do
  name=$(basename "$fixture" .answers.json)
  out=$(mktemp -d)
  trap 'rm -rf "$out"' EXIT

  if ! node scripts/resolve.mjs --answers "$fixture" --out "$out/plan.json" --quiet; then
    fail "$name (resolve)"
    continue
  fi
  if ! node scripts/render.mjs --plan "$out/plan.json" --out "$out/payload" >/dev/null; then
    fail "$name (render)"
    continue
  fi

  golden="tests/golden/$name"
  if [ ! -d "$golden" ]; then
    fail "$name — no golden tree; run tests/update-golden.sh"
  elif diff -ru "$golden" "$out/payload"; then
    pass "$name"
  else
    fail "$name — output differs from golden (above)"
  fi
  rm -rf "$out"
done

# --- 3b. golden scaffold plan per fixture ------------------------------------
# The --dry-run output is exactly what the user approves before anything runs,
# so it is worth pinning. Offline and instant: it never invokes dotnet or npm,
# but it does catch a var that stops expanding or a command that moves.
step "golden scaffold"
for fixture in tests/fixtures/*.answers.json; do
  name=$(basename "$fixture" .answers.json)
  out=$(mktemp -d)

  node scripts/resolve.mjs --answers "$fixture" --out "$out/plan.json" --quiet
  # A fixed fake root keeps the output stable across machines.
  node scripts/scaffold.mjs --plan "$out/plan.json" --root /tmp/kit-golden --dry-run \
    >"$out/scaffold.txt" 2>&1

  golden="tests/golden/$name.scaffold.txt"
  if [ ! -f "$golden" ]; then
    fail "$name — no scaffold golden; run tests/update-golden.sh"
  elif diff -u "$golden" "$out/scaffold.txt"; then
    pass "$name"
  else
    fail "$name — scaffold plan differs from golden (above)"
  fi
  rm -rf "$out"
done

# --- 4. the drift check that motivated the whole generator --------------------
# CLAUDE.md's skill list, the agent's `skills:` frontmatter, and the actual
# skills/ directory must agree. Both source repos had these three disagree.
#
# Workflow skills are the one deliberate exception: they are base-owned and
# driven by a human or by /loop, so they appear on disk and in CLAUDE.md but in
# no agent's `skills:` list. The check compares the agent list against the
# STACK skills only, and CLAUDE.md against everything.
step "no drift"
for golden in tests/golden/*/; do
  name=$(basename "$golden")
  on_disk=$(find "$golden/skills" -name SKILL.md -exec dirname {} \; | xargs -n1 basename | sort -u | tr '\n' ' ')
  in_agent=$(grep -h '^skills:' "$golden"/agents/*.md | sed 's/^skills: //' | tr ',' '\n' | tr -d ' ' | sort -u | tr '\n' ' ')
  # Only the Skills section — the Agents section above it also uses `backticks`.
  in_claude=$(sed -n '/^### Skills/,/^<!--/p' "$golden/CLAUDE.md" \
    | sed -n 's/^- `\(.*\)`$/\1/p' | sort -u | tr '\n' ' ')
  # The Workflow group, verbatim from the same generated list.
  workflow=$(sed -n '/^\*\*Workflow\*\*/,/^$/p' "$golden/CLAUDE.md" \
    | sed -n 's/^- `\(.*\)`$/\1/p' | sort -u | tr '\n' ' ')
  stack=$(printf '%s\n' $on_disk | grep -vxF -f <(printf '%s\n' $workflow) 2>/dev/null | sort -u | tr '\n' ' ')
  [ -z "$workflow" ] && stack="$on_disk"

  if [ "$stack" = "$in_agent" ] && [ "$on_disk" = "$in_claude" ]; then
    pass "$name — skills/ == agent frontmatter + workflow == CLAUDE.md"
  else
    fail "$name drift: dir[$on_disk] stack[$stack] agent[$in_agent] claude[$in_claude]"
  fi
done


# --- 4b. the generated guard hook must actually guard -------------------------
# The hook ships with its own fixture because its failure mode is silent AND
# inverted: a PreToolUse hook that errors exits 2, which the harness reads as
# "blocked". A guard broken by an unquoted `|` inside `[[ =~ ]]` looks identical
# to a working one right up until it blocks something you needed.
step "generated hooks"
HOOKSB=$(mktemp -d)
if node scripts/resolve.mjs --answers tests/fixtures/nextjs-shadcn.answers.json --out "$HOOKSB/plan.json" --quiet \
   && node scripts/render.mjs --plan "$HOOKSB/plan.json" --out "$HOOKSB/.claude" >/dev/null; then
  ( cd "$HOOKSB" && git init -q . && git commit -q --allow-empty -m init ) >/dev/null 2>&1
  OUT_HOOK=$( cd "$HOOKSB" && ./.claude/hooks/test-protect-plan-artifacts.sh 2>&1 )
  if [ $? -eq 0 ]; then
    pass "protect-plan-artifacts — $(printf '%s' "$OUT_HOOK" | tail -1)"
  else
    printf '%s\n' "$OUT_HOOK"
    fail "protect-plan-artifacts fixture"
  fi
  # Every generated shell file must at least parse. A template that renders a
  # syntax error still writes a file, and nothing else here would notice.
  for f in "$HOOKSB"/.claude/hooks/*.sh "$HOOKSB"/.claude/scripts/*.sh; do
    if ! bash -n "$f" 2>/dev/null; then fail "syntax error in $(basename "$f")"; fi
  done
  pass "generated shell parses"
else
  fail "generated hooks (render)"
fi
rm -rf "$HOOKSB"

# --- 5. the scripts must work from a symlinked install path -------------------
# import.meta.url resolves symlinks, process.argv[1] does not. A naive main-module
# guard makes both scripts silently no-op (exit 0, no files) when the plugin lives
# under /tmp or /var on macOS. Regression test for exactly that.
step "symlinked install path"
FAKE=$(mktemp -d)/plugins
mkdir -p "$FAKE"
cp -R . "$FAKE/claude-kit" 2>/dev/null
SB=$(mktemp -d)
mkdir -p "$SB/.claude-kit"
cp tests/fixtures/nextjs-shadcn.answers.json "$SB/.claude-kit/answers.json"
node "$FAKE/claude-kit/scripts/resolve.mjs" --answers "$SB/.claude-kit/answers.json" --out "$SB/.claude-kit/plan.json" --quiet
node "$FAKE/claude-kit/scripts/render.mjs" --plan "$SB/.claude-kit/plan.json" --out "$SB/.claude" >/dev/null
COUNT=$(find "$SB/.claude" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then pass "generated $COUNT files from a copied install"; else fail "silent no-op — main-module guard is broken"; fi
rm -rf "$FAKE" "$SB"

printf '\n'
[ "$FAILED" -eq 0 ] && printf '\033[32mall green\033[0m\n' || printf '\033[31mfailures above\033[0m\n'
exit "$FAILED"
