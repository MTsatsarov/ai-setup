---
name: create-task
description: Draft a Jira issue from a description, get it approved, then create it. Writes the draft to a file first so the wording is reviewable before anything is published.
argument-hint: "<description of the work>"
---

# /create-task — Draft, Approve, Create

The on-ramp to the loop. `/plan-task` picks up the issue it creates.

## Step 1 — Draft to a file first

Write `docs/plans/../tasks/<slug>.md`:

```markdown
---
type: Task | Bug | Story
summary: <the issue title>
---

## Summary
## Detailed Description
### Backend
### Tests
### Frontend

## Acceptance Criteria
- [ ] ...

## Open Questions
```

A file, not a direct API call, because an issue is read by other people and its
wording is the requirement. Drafting into the terminal means the only reviewable
copy is one scroll away from being lost.

## Step 2 — Collect the open questions

Anything you had to assume goes under Open Questions. Do not resolve them by
guessing — an assumption written down can be corrected by whoever reads the
issue.

## Step 3 — Wait for approval

Print the draft and end the turn with:

```
Reply: **create** · **edit** (say what to change) · **cancel**
```

**Never create the issue without an explicit reply.** Creating one is
outward-facing: other people get notified, and deleting it afterwards does not
un-notify them.

## Step 4 — Create

Create the issue over MCP, post the Open Questions as a comment on it, and print
the key and URL. Then:

```
Next: /plan-task <KEY>
```
