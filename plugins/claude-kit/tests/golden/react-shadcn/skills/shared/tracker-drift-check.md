# Shared: Jira Drift Check

**This is not a skill** — it is executed at every stage boundary of a
loop-driven run.

## Why this exists

The Jira task is the one input a **human can change underneath a
running loop**. A loop's normal stop condition asks *"is the work done?"*; this
one asks *"is the work still the work?"*

So drift is an **abort**, not a gate. A run that keeps going after the
requirements changed is not being resilient — it is producing, verifying and
opening a PR for the wrong thing, confidently.

## The contract

1. Fingerprint once, at plan time.
2. Compare at every stage boundary — one read per boundary.
3. On drift: **stop**. Never push, never remove a worktree, never silently
   re-plan.
4. When uncertain, stop. The cost of a false stop is one message to the user;
   the cost of a missed drift is an entire run.

## 1 — Fingerprint (at plan time)

Read the task once and record:

```bash
.claude/scripts/plan-state.sh <ID> set \
  jira.updated="<last-modified timestamp>" \
  jira.descriptionHash="<shasum -a 256 of the description | cut -c1-16>" \
  jira.status="<current status>" \
  jira.commentCount=<n> \
  jira.lastCommentId="<id of the newest comment>"
```

Also write the raw description to `docs/plans/<ID>.task.txt`, so a
drift report can quote the before and after rather than asserting that something
changed.

## 2 — Compare (at every boundary)

| Observation | Verdict |
|---|---|
| `descriptionHash` differs | **STOP** |
| a new comment id appears | classify it — see §3 |
| `commentCount` dropped | **STOP** — a comment was deleted |
| an existing comment's body changed | **STOP** |
| status is now Done / Closed / Blocked / Cancelled | **STOP** |
| only the last-modified timestamp moved | continue, and note it |

The timestamp alone is a cheap early-out: when it has not moved, nothing else
can have.

## 3 — Classifying a new comment

**STOP** when the comment carries business content: a new or changed acceptance
criterion, a new rule, edge case, validation or permission, "actually it
should…", a scope change in either direction, a correction, or an answer to one
of the plan's Open Questions.

**CONTINUE** when it is administrative: a ping, a link with no instruction,
assignment or sprint chatter, or QA notes about already-shipped work.

When it is genuinely ambiguous, **STOP**.

## 4 — The stop report

Write a stop record per `.claude/skills/shared/stop-record.md` with
`stop.reason=drift`, then print:

```
⚠ Jira drift detected on <ID> — stopped at stage: <stage>

What changed:  <the field, and how>
Before:        <quoted from docs/plans/<ID>.task.txt>
After:         <quoted from the task as it is now>
Why it matters: <what in the plan is now wrong>

Already done:  <areas implemented, verify verdict, PR if any>
Worktree:      <path — left in place>
Nothing was committed or pushed.

Reply: **replan** · **continue** · **stop**
```

On **continue**, re-fingerprint first — otherwise the next boundary stops on the
same drift again. On **replan**, preserve `branchSlug`, `branchName`, `prNumber`
and the worktree; the work so far is still the work.

## Where this runs

| Caller | When |
|---|---|
| `/plan-task` | writes the fingerprint |
| `/implement-plan` | before delegating to any agent |
| `/ship` | preflight, and before implement, PR and self-check |
| `/pr-watch` | first tick of a session only |
