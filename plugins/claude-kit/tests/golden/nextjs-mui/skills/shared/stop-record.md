# Shared: Stop Record

**This is not a skill** — it is executed by any skill that halts a run before it
reaches `ready`.

## Why this exists

A loop stops for one of a few reasons, and each is a message *to a human who is
not currently looking*:

| Stop | Meaning |
|---|---|
| **`needs-decision`** | a judgement call that is not ours to make — an open question, or a finding no agent may auto-apply |
| **`verify-failed`** | the change does not work, and 3 attempts did not fix it |
| **`tests-missing`** | the change works, and nothing proves it — the plan asked for tests and none arrived |
| **`push-blocked`** | the work is done but the verdict is not `PASS`, so invariant 3 forbids the push |
| **a no-retry `CAUSE:`** | the failure is not a code defect, so retrying would damage correct code |
| **`drift`** | the ClickUp task changed underneath the run |

An autonomous run is exactly the case where nobody is watching. If the reason
lives only in the terminal, it is lost to a context compact, a closed session, or
simply walking away for the twenty minutes a full run takes. **The stop must
outlive the turn that produced it.**

## The contract

Before printing any stop report, write both of these. They are cheap, and they
are the difference between "the loop stopped" and "the loop told you why".

### 1. Structured — into the state file

```bash
.claude/scripts/plan-state.sh <ID> set \
  stage=stopped \
  stop.reason=<needs-decision|verify-failed|tests-missing|push-blocked|drift> \
  stop.stage=<the stage that was running> \
  stop.summary="<one line, no newlines>" \
  stop.report=docs/plans/<ID>.stop.md
```

`stage=stopped` is deliberate: it is not one of the normal stage-machine values,
so a later `/ship <ID>` sees it and surfaces the stop instead of silently
resuming into the same wall.

### 2. Human-readable — `docs/plans/<ID>.stop.md`

A working artifact like everything else under `docs/plans/` —
visible in `git status` on purpose, never staged (invariant 2). Overwrite it on
each new stop; there is only ever one live stop per task.

```markdown
# Stopped: <ID> — <reason>

**Stage:** <stage>   **Recorded:** <ISO timestamp>
**Verify:** <tier> · <scope> · attempts <n>/3
**Worktree:** <path — left in place, invariant 11>
**PR:** <number and URL, or "none yet">

## Why

<the full report, verbatim as printed to the terminal — for a verify failure,
the failing step and what each of the 3 attempts tried; for a decision, the
finding and the question it raises>

## What was already done

- <which areas were implemented, and which verified green>
- <files touched>
- Committed: <yes, and the sha — or no>

## To resume

<the exact commands, including how to clear the stop>
```

## Reading it back

Every stage's preflight checks for a recorded stop **before** the stage lookup:

```bash
.claude/scripts/plan-state.sh <ID> get stop.reason
```

Non-empty means the previous run halted for a reason a human has not yet
answered. Surface `stop.summary` and the path in `stop.report`, and **stop** —
including `ScheduleWakeup({stop: true})` if a `/loop` is driving. Resuming into
the same wall wastes a full run and buries the original reason under a second
copy of it.

Clear it only once the user has responded, folding their answer into the plan
file first:

```bash
.claude/scripts/plan-state.sh <ID> set stop.reason=null stage=<resumed stage>
```

## What this does not do

It does not notify you. The `Notification` hook in `.claude/settings.json`
already fires a desktop alert when Claude Code needs attention. This file is
about the *reason* surviving long enough to be read afterwards.
