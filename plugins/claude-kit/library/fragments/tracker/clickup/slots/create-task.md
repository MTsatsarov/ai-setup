---
name: create-task
description: Draft a ClickUp task from a description, get it approved, then create it. Writes the draft to a file first so the wording is reviewable before anything is published.
argument-hint: "<description of the work>"
---

# /create-task — Draft, Approve, Create

The on-ramp to the loop. `/plan-task` picks up the task it creates.

## Step 1 — Draft to a file first

Write `<% project.plans_dir %>/../tasks/<slug>.md`:

```markdown
---
type: Task | Bug | Story
summary: <the task title>
---

## Summary
## Detailed Description
<% each areas %>### <% .label %>
<% end %>
## Acceptance Criteria
- [ ] ...

## Open Questions
```

A file, not a direct API call, because a task is read by other people and its
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

**Never create the task without an explicit reply.** Creating one is
outward-facing: other people get notified, and deleting it afterwards does not
un-notify them.

## Step 4 — Create

Create the task over MCP, post the Open Questions as a comment on it, and print
the task id and URL. Then:

```
Next: /plan-task <task-id>
```
