---
name: verify-change
description: Verify the current change builds, lints and passes its tests — and fix it until it does. Runs the project's checks for whichever areas actually changed, and on failure diagnoses the breakage, routes the fix to the owning agent, and reruns from the top, up to 3 attempts. Ends with a machine-readable PASS/FAIL verdict. Use after implementing anything, and before handing work back.
argument-hint: "[quick|tests|full|integration] [backend|tests|frontend|all] — defaults to quick, auto-scoped"
---

# /verify-change — The Definition of Done

This skill is the project's definition of "it works." Every other workflow skill
defers to it, so that **verified** means exactly one thing everywhere in the
chain.

Hold `.claude/skills/shared/safety-invariants.md` throughout — invariants 3 and
4 in particular, because this is the skill with the motive to break them.

## Contract — what callers rely on

- The **last thing printed** is a fenced ` ```verify ` block ending in
  `VERDICT: PASS` or `VERDICT: FAIL`.
- This skill **never touches git state**. It does not stage, commit, push,
  branch or revert. It only edits source files.
- A `FAIL` verdict is a hard stop for the caller. Never report success, and
  never hand work back as done, on anything but `PASS`.

## Step 1 — Run the gate

```bash
.claude/scripts/verify.sh <tier> <scope> [<workdir>]
```

That is the whole of step 1. **Do not run the underlying build, lint or test
commands by hand.** The script owns them so the command set stays identical
everywhere, and so build logs stay out of the conversation unless something
actually fails.

### Tiers

| Tier | Runs | Use for |
|---|---|---|
| `quick` | compile + lint, per area | the inner fix loop — the default |
| `tests` | the backend suite, without the other areas' legs | `backend-tester`'s inner loop |
| `full` | everything except integration | before `/pr`, and before any push |
| `integration` | + suites needing external services | explicitly, on request |

**Never put `integration` inside a retry loop.** It is the slowest tier and its
failures are most often environmental, which is precisely the thing a retry loop
must not chase.

Scope defaults to `auto`, which detects changed areas from the working tree —
falling back to the diff against `origin/main` on a clean
tree. Pass an explicit scope only when you already know it and want to skip the
detection.

## Step 2 — Read the verdict, not the output

`PASS` — you are done. Print the block and stop.

`FAIL` — the block names the failing step, and the script has already echoed
only the matching error lines from that step's own log. Start from those.

`WARN:` lines never change the verdict. They are heuristics — a schema changed
with no migration, say — and they are advisory on purpose: a false failure would
burn all three fix attempts chasing a non-problem.

`CAUSE:` lines mean **stop**. See below.

## Step 3 — The bounded fix loop

A bounded loop, **maximum 3 attempts**. State the attempt number out loud each
time (`verify attempt 2/3`).

- **Attempt 1** — read the failing lines, open the offending files, fix the
  reported error. Nothing else.
- **Attempt 2** — if the same step fails again, **re-read the governing skill
  file first**. Repeating the same guess is not an attempt.
- **Attempt 3** — last try. If it fails, stop and report; do not continue.

**Persist the counter before each attempt**, so it survives a compact:

```bash
.claude/scripts/plan-state.sh <ID> set <area>Attempts=<n>
```

A counter that lives only in your context silently resets to a fresh 3 attempts
when the conversation compacts, which is exactly the runaway the cap exists to
prevent.

### Routing a failure

Route by the path of the failing file:

| Failing path matches | Route to |
|---|---|
| `^apps/api/` | `backend-developer` |
| `(^apps/api/test/|\.spec\.ts$|\.e2e-spec\.ts$)` | `backend-tester` |
| `^apps/web/` | `frontend-developer` |

Never hand a failure to an agent that does not own the area (invariant 9),
whatever the root cause turns out to be. When two areas are plausible causes,
decide which side is actually wrong before routing — routing a correct test to
the implementer is how a real bug gets "fixed" by rewriting the test that caught
it.

### Forbidden ways to reach green

Invariant 4 is the list. Two additions specific to this skill:

- **Never widen the change beyond the reported error.** A fix attempt that
  refactors a neighbouring file has stopped being a fix attempt.
- **Never edit `docs/plans/**` or `docs/qa/**` to make
  a check pass.** Those are the record of what was asked for.

### Failures you must NOT retry

A `CAUSE:` line means the failure is not a code defect, so repairing the symptom
damages correct code. **Stop and report it.** Do not route it to an agent, and
do not spend an attempt on it.

Environmental failures — missing dependencies, a stopped service, a failed
restore — are the same: fix the environment, then restart the count. That rerun
is attempt 1, not attempt 2; the earlier failure was never a real attempt.

## Step 4 — Report

Print the verdict block. That is the deliverable.

If a loop invoked this skill and the result is `FAIL` or a no-retry `CAUSE:`,
write a stop record first, per `.claude/skills/shared/stop-record.md`, with
`stop.reason=verify-failed`. Used interactively, no stop record is needed —
someone is reading the terminal.
