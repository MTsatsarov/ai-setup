---
name: ship
description: Take a one-line description to a reviewed draft PR autonomously — plan, implement, verify until green, open a draft PR, self-review and fix — stopping only for open questions or a failure it cannot resolve. Works in a dedicated git worktree so the main checkout is never touched.
argument-hint: <"free-text description" on the first run, then the resolved slug>
---

# /ship — The Stage Machine

Drives the whole chain: plan → implement → PR → self-check → report.

```
/loop /ship punch-card-expiry
```

Hold `.claude/skills/shared/safety-invariants.md` at **every** stage. Full
autonomy means nobody is watching, so the guardrails have to be in the file
rather than in the moment.

## One stage per invocation

**Run exactly one stage, then end the turn. Never two.**

This is the rule that makes the stage machine worth having. A full run in a
single context is both the most expensive context in this repo and the one most
likely to compact halfway through — and a compact mid-stage loses the attempt
counters along with everything else. One stage per invocation makes every stage
a fresh context by construction.

The repeating comes from the harness, not from you. At the end of a stage call
`ScheduleWakeup` with:

- `delaySeconds: 60` — the next stage is real work, not a wait on external state
- `noop: false` — the stage advanced something
- `prompt: "/ship <ID>"` — **the resolved id, never the original description**

That prompt is load-bearing. Stage 1 turns a sentence into a slug; if the
wake-up still carries the sentence, every wake-up re-enters Stage 1, re-plans
from scratch, and the run never advances while looking perfectly busy. Pass
`/ship punch-card-expiry`, not `/ship "punch cards should…"`.

On `stage=ready` or `stage=stopped`, call `ScheduleWakeup({stop: true})` instead
— a finished or halted task must not keep waking up.

Invoked **without** `/loop`, behave identically: run one stage, print what
advanced and what runs next, and stop. The user re-invokes.

## The stage machine

```
(no state) → planned → implementing → verified → pr-open → self-checked → ready
          ↘ (any boundary) ─────────────────────────────────────────────→ stopped
```

| Stage | Next action |
|---|---|
| *(no state file)* | Stage 1 — Plan |
| `planned` | Stage 2 — Implement |
| `implementing` | Stage 2 — Implement (resume) |
| `verified` | Stage 3 — PR |
| `pr-open` | Stage 4 — Self-check |
| `self-checked` | Stage 5 — Report |
| `ready` | nothing — say so and stop the loop |
| **`stopped`** | **do not resume** — see Stage 0 |

## Stage 0 — Preflight

Runs at the head of **every** invocation, before the stage lookup. It is cheap —
no build, no agents — and it is what makes the autonomy safe. Do not skip it.

1. **Resolve the id**, by the rule in `/plan-task` Step 0. State which you
   resolved.

2. **Resolve the main checkout.** `.claude/` may not exist inside a linked
   worktree, so every path below is absolute against `$MAIN`:

   ```bash
   MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
   git worktree prune
   ```

3. **Check for a recorded stop:**

   ```bash
   "$MAIN"/.claude/scripts/plan-state.sh <ID> get stop.reason
   ```

   Non-empty means the previous run halted for a reason nobody has answered.
   Surface `stop.summary` and `stop.report`, and **stop** — including
   `ScheduleWakeup({stop: true})`. Resuming into the same wall wastes a full run
   and buries the original reason under a second copy of it.

## Stage 1 — Plan

Only when there is no state file. Runs in the main checkout.

**Refuse to start on a dirty working tree.** `git status --porcelain -uall` must
be empty. If it is not, print the dirty files and stop; **the loop never commits
or stashes them for you** (invariants 1 and 2).

Two reasons, and neither is fussiness: work already in the tree would be
reviewed by Stage 4 as though this run had written it, and the final report
would list files the run never touched. A clean start is what makes "everything
in the diff is the run's work" true.

This check belongs **here only**. From Stage 2 on the tree is dirty by
construction — that is the run's own output — and re-checking would halt the
loop on itself.

Record the baseline, then execute `/plan-task`:

```bash
"$MAIN"/.claude/scripts/plan-state.sh <ID> set baseline.head="$(git rev-parse HEAD)"
```

**Print the plan summary** — there is no approval gate on a clean plan, so the
printed summary is the only thing that makes the run auditable afterwards.

**The one gate — Open Questions.** If the plan has any, this is where the run
stops: write a `needs-decision` stop record, print the questions, and call
`ScheduleWakeup({stop: true})`.

Set `stage=planned`, then end the turn.

## Stage 2 — Implement

**Stage 2a — the worktree** (idempotent; it needs `branchSlug`, which is why it
lives here rather than in Stage 1):

```bash
SLUG=$("$MAIN"/.claude/scripts/plan-state.sh <ID> get branchSlug)
[[ -z "$SLUG" ]] && { echo "no branchSlug — Stage 1 did not complete"; exit 1; }

WORKTREE=~/repos/mapster-shop-worktrees/<ID>
if ! git worktree list | grep -q "$WORKTREE"; then
  USER=$(gh api user --jq .login)
  mkdir -p ~/repos/mapster-shop-worktrees
  git fetch origin main
  git worktree add "$WORKTREE" -b "$USER/$SLUG" origin/main
fi
"$MAIN"/.claude/scripts/plan-state.sh <ID> set worktree="$WORKTREE"
```

A worktree keeps the main checkout and its uncommitted work untouched for the
twenty minutes this run takes.

**Stage 2b** — execute `/implement-plan <ID>` inside the worktree. Its own
self-check step is **skipped here**; Stage 4 runs it as its own stage, and doing
it twice doubles the cost for nothing.

Hard aborts: `FAIL` after 3 attempts, any no-retry `CAUSE:`, or `tests-missing`.
In each case `/verify-change` or `/implement-plan` has already written the stop
record — surface it and halt the loop.

Set `stage=verified` only on `PASS`.

**Resuming after a compact must not re-dispatch finished work.** Skip tasks
already ticked in the plan file, and read the attempt counters back from the
state file rather than restarting the count.

## Stage 3 — PR

```bash
PR_NO_WEB=1 "$MAIN"/.claude/scripts/pr.sh "<ID>" "<branchSlug>" "<commit message>"
```

`pr.sh` writes `prNumber`, `prUrl`, `branchName` and `stage=pr-open` itself.

## Stage 4 — Self-check

Execute `/pr-self-check <prNumber> --auto` against the existing worktree.
**This stage never asks** — see `--auto` in that skill for the decision table.
Only `PASS` pushes; anything else writes a `push-blocked` stop record and halts.

Then assert — do not repair:

```bash
ls "$WORKTREE"/docs/plans/ 2>/dev/null && echo "⚠ artifact written to the worktree — a path resolution regressed"
```

Assert rather than copy. A `cp` mop-up would quietly paper over the regression it
exists to catch.

Set `stage=self-checked`.

## Stage 5 — Report

Write the report **before printing anything**, per
`.claude/skills/shared/run-report.md`. It sets `stage=ready` and `report.path`.

Under **one stage per invocation** the earlier stages ran in other contexts, so
this stage does not have the run in its own history. Reconstruct it from the
artifacts — that is what they are for. If a value is not recorded anywhere, say
so; an invented attempt count is worse than an absent one.

By now the worktree is normally already gone, so write to `$MAIN`.

Then print a short terminal summary ending in the literal next commands:

```
gh pr ready <PR>
/loop 15m /pr-watch <PR>
```

Finally, `ScheduleWakeup({stop: true})`.

## Caps

| Cap | Where it lives |
|---|---|
| 3 verify attempts for Backend | `verify.backendAttempts` |
| 3 verify attempts for Tests | `verify.testsAttempts` |
| 2 self-check rounds | `selfCheck.round` |

**All of them live in the state file, not in your head.** One stage per
invocation means "your head" does not survive to the next stage.

## When not to use this

For tasks whose shape is already clear. For anything exploratory, ambiguous or
architecturally open, run the stages by hand and read the output between them.
`/ship` removes the gates; it does not remove the need for judgement about when
gates matter.
