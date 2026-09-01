---
name: implement-plan
description: Read an implementation plan and execute it with the developer agents, verifying after each area and fixing until the gate is green. Stops rather than handing back a broken change.
argument-hint: <task id, as resolved by /plan-task>
---

# /implement-plan — Execute the Plan

Runs the areas in dependency order, verifying after each, and never hands back
work that does not pass the gate.

Hold `.claude/skills/shared/safety-invariants.md` throughout.

## Step 1 — Preflight

```bash
.claude/scripts/plan-state.sh $ARGUMENTS get stop.reason
```

Non-empty means the previous run halted for a reason nobody has answered.
Surface it and stop — see `.claude/skills/shared/stop-record.md`.

Read `docs/plans/$ARGUMENTS.md` and the state file, then:

```bash
.claude/scripts/plan-state.sh $ARGUMENTS set stage=implementing
```

Announce the task counts per area.

**If any `[ ]` boxes are already ticked, this is a resumed run.** Skip the
finished tasks, and read the attempt counters back from the state file rather
than restarting the count. A resumed run that restarts its counters has silently
granted itself three more attempts.

## Step 2 — Implement, area by area

### Backend

Delegate the **Backend Tasks** to `backend-developer`. Give it the plan path and
require it to **tick each `[ ]` as it completes it** — that is a hard
requirement, not bookkeeping. Without it the plan file ends every run looking
untouched, and nothing downstream can tell what actually got done.

Do **not** give it the Tests section. An implementer writing its own tests
writes tests that agree with what it built, which is the one thing a test must
not do.

Then:

```bash
.claude/scripts/verify.sh quick backend
```

On `FAIL`, hand back **only the reported breakage** — max 3 attempts, counter
persisted to `verify.backendAttempts` before each one. On a no-retry `CAUSE:`, stop
immediately and write a stop record; do not route it to an agent.

### Tests

Delegate the **Tests Tasks** to `backend-tester`. Give it the plan path and
require it to **tick each `[ ]` as it completes it** — that is a hard
requirement, not bookkeeping. Without it the plan file ends every run looking
untouched, and nothing downstream can tell what actually got done.

Do **not** give it the Tests section. An implementer writing its own tests
writes tests that agree with what it built, which is the one thing a test must
not do.

Then:

```bash
.claude/scripts/verify.sh quick tests
```

On `FAIL`, hand back **only the reported breakage** — max 3 attempts, counter
persisted to `verify.testsAttempts` before each one. On a no-retry `CAUSE:`, stop
immediately and write a stop record; do not route it to an agent.

Areas that do not depend on each other may be dispatched in
parallel in a single message. Never start a dependent area on a failing one.

## Step 3 — Tests

### The tests gate

If the plan's Tests section is not a single `None: <reason>` line and **no test
file was added or modified**, stop. Write a stop record with
`stop.reason=tests-missing`, and do not print a handoff to `/pr`. The change may
well work; nothing shows that it does, and that is the same problem one week
later.

## Step 4 — Full verification

```bash
.claude/scripts/verify.sh full
```

Same 3-attempt loop. Offer the `integration` tier; never run it automatically.

## Step 5 — Record

```bash
.claude/scripts/plan-state.sh $ARGUMENTS set \
  stage=verified verify.verdict=PASS verify.tier=full
```

Only on `PASS`.

## Step 6 — Report

State, in this order: files created, files modified, migrations, tests (with the
case matrix and the diff-hunk mapping), any deviation from the plan and why, and
**any task left unticked**. Then the verdict block.

Never describe the work as complete on anything but `PASS`, and never soften a
`FAIL` into "mostly working".

End with the handoff, pre-filled from the state file:

```
/pr <ID>
```
