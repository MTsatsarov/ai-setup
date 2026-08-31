---
name: pr-watch
description: One tick of a PR watch — check CI and new review comments on a pull request, fix what is mechanically fixable, and stop when it needs a human. Drive it with /loop on an interval; it is deliberately not a loop by itself.
argument-hint: <PR number>
---

# /pr-watch — One Tick

**This skill is one tick, not a loop.** The loop is supplied by the harness:

```
/loop 15m /pr-watch <PR>
```

Never below 15 minutes. CI runs cancel in progress on most setups, so a faster
poll mostly measures builds it just cancelled.

Hold `.claude/skills/shared/safety-invariants.md` throughout.

## The cursor is the only memory this loop has

Every tick is a fresh context. There is no session, only ticks. State lives in
`docs/plans/pr-<PR>.watch.json`:

```json
{ "lastHeadOid": "", "lastRollup": "", "lastCommentId": 0, "ticks": 0,
  "lastDriftTick": -1, "draftNoticeTick": -1, "pushes": 0, "pending": null }
```

Bump `ticks` on **every** tick, including quiet ones.

## Step 1 — A pending question short-circuits everything

A non-null `pending` means the previous tick asked a human something and nobody
has answered. Re-surface it verbatim and stop. Asking again in different words
is how a watch loop turns into noise.

## Step 2 — Early exits

- **closed or merged** → report and stop the loop
- **still a draft** → CI does not run on drafts. Say so **once**, recording
  `draftNoticeTick`, then stay quiet
- **nothing changed** since the cursor → print exactly
  `#<PR> — no change (tick <n>)` and stop. The value of a watch loop depends on
  quiet ticks being genuinely quiet
- **drift** → run `.claude/skills/shared/tracker-drift-check.md` when
  `ticks - lastDriftTick >= 4`, or whenever the head or comment cursor moved

## Step 3 — Act on what changed

**Failing CI** → map the failing job to the nearest local tier and reproduce it:

```bash
.claude/scripts/verify.sh <tier>
```

Fix from the local failure, not from the CI log — the log tells you which check
failed; the local run tells you why, and is the thing you can iterate against.

**New human comments** → hand them to `/pr-self-check <PR>`, rather than
inventing a second review path here. One review engine, one finding set.

## Step 4 — The push gate

**A time-based loop never pushes on its own.** Write `pending` into the cursor
**before** asking, print the question, and call `ScheduleWakeup({stop: true})`.
The next tick will re-surface it until a human answers.

Cap fix-pushes at 3 via `pushes`. A watch that has pushed three times and is
still not green has stopped converging.

## Settled — when to stop the loop

Open, not draft, every check concluded successfully, no unaddressed human
comment, and not conflicting. Report it and call `ScheduleWakeup({stop: true})`.
