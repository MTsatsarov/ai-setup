---
name: plan-task
description: Turn a one-line description into an implementation plan the loop can execute. Explores the codebase, writes the plan file, and seeds the workflow state the later stages read.
argument-hint: <"free-text description of the task" | the slug it resolved to>
---

# /plan-task — From Intent to an Executable Plan

Produces two artifacts the rest of the chain depends on: the plan file at
`docs/plans/<ID>.md`, and the seeded state file.

Hold `.claude/skills/shared/safety-invariants.md` throughout.

## Step 0 — Resolve the id

`$ARGUMENTS` is either an id or a description of the work.

**It is an id only when it matches `^[a-z0-9]+(-[a-z0-9]+)*$`** — that is,
a kebab-case slug derived from your description (e.g. punch-card-expiry). **Anything containing a space is a description**,
and means this is a first run.

State which one you resolved, in one line, before doing anything else.

For a description, derive a **kebab-case slug of 2–4 words** from the intent —
`punch-card-expiry`, not `fix-the-thing`. That slug becomes the id, the plan
filename, the state filename and the branch name, so it is worth ten seconds.
`plan-state.sh` rejects anything that is not a clean slug; if it rejects yours,
fix the slug rather than working around it. Two spellings means two state files,
and a loop that silently loses its attempt counters between stages.

## Step 1 — The description is the whole brief

There is no ticket, no comment thread and no acceptance criteria anyone else
wrote. `$ARGUMENTS` plus this plan file are the **only** record of intent, which
makes two things true:

- Write the acceptance criteria yourself, explicitly, from the description. If
  you cannot state what "done" means, that is an Open Question, not a detail.
- Anything you assume must appear in the plan as an assumption. An assumption in
  the file can be corrected; one in your head cannot.

## Step 2 — Explore before planning

Dispatch an Explore subagent over the areas the task touches. Prefer LSP
`workspaceSymbol` and `findReferences` over grep for impact tracing — the
question "what else calls this" is the one that turns a two-file change into a
six-file one, and it is much better answered now than during implementation.

Name the existing things the work should reuse. A plan that says "add a service"
when a service already exists is how duplication gets introduced deliberately.

## Step 3 — Write the plan

Write `docs/plans/<ID>.md`:

```markdown
# Implementation Plan: <ID>

## Task Summary
## Acceptance Criteria
## Technical Analysis
<affected areas, existing code to reuse, dependencies and risks>

## Backend Tasks
1. [ ] ...

## Tests Tasks
1. [ ] ...

## Database Changes

## Verification
- Scope: backend, tests
- Tier: full
- Manual QA: yes/no — if yes, what to click
- Checkable acceptance:
  - [ ] <each acceptance criterion restated as something a check or a named manual step proves>

## Open Questions
```

Two sections are contracts, not formalities:

**Verification** is read by `/implement-plan` to pick the scope and tier. A plan
without it makes the loop guess.

**Tests** — the ``
task list — is load-bearing. The only accepted way to skip it is a single line
reading `None: <reason>`. An empty section is a planning defect and stops the
run, because "no tests" and "nobody thought about tests" are indistinguishable
afterwards.

## Step 4 — Seed the state

```bash
.claude/scripts/plan-state.sh <ID> set \
  stage=planned \
  branchSlug="<kebab-case, 2-4 words>" \
  verify.tier="<quick|full|integration, from the Verification section>" \
  qa.warranted=<true|false> \
  qa.what="<one line: what to click — empty when false>"
```

This is what lets each stage hand values to the next without a human retyping
them.

## Step 5 — Summary

Print the plan summary: what will change, in which areas, what will be tested,
and any Open Questions.

**Open Questions are blocking.** With no ticket
behind this task, an unanswered question does not stay a question: the loop picks
a reading, implements it, and verifies it enthusiastically. That is the most
expensive failure this machine has, and one message prevents it.

End the turn with exactly this line, and **make it the final message of the
turn** — do not call `AskUserQuestion` in the same turn, because the question UI
replaces the report on screen and the user never sees the plan:

```
Reply: **go** (run /implement-plan <ID>) · **edit** (say what to change) · **stop**
```
