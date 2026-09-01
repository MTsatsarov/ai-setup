---
name: manual-qa
description: QA a change in the running app like a human tester — drives a real browser, covers happy and unhappy paths, and reports findings without fixing them. Human-triggered; the loop suggests it and never runs it.
argument-hint: "[<task id> | \"free-text: what to test\"] — optional; defaults to auto-detect from the change"
---

# /manual-qa — Drive the App Like a Person

**Not in the loop.** `/ship` prints `/manual-qa <ID>` as a next command and
stops. QA drives a real browser against a real running stack; it stays
human-triggered, because it has no gate behind it and no bounded fix loop.

Read `.claude/skills/shared/qa-test-plan.md` in full first — it is the
discipline this skill executes.

## Step 1 — Resolve what to test

Three modes:

- **task-driven** — a task id: read `docs/plans/<ID>.md` and its
  `qa.what`, and report to `docs/qa/<ID>.md`
- **free-text** — test exactly what was asked, report to
  `docs/qa/<kebab-slug>.md`
- **change-driven** — no argument: derive the scope from the change set, the
  same way `.claude/skills/shared/review-pipeline.md` §1 does, `-uall` included

## Step 2 — Gate on the environment

```bash
.claude/scripts/qa-env.sh --start
```

`VERDICT: BLOCKED` → stop, and print its `CAUSE:` and `HINT:` lines verbatim.
Do not improvise around a blocked environment; a QA pass against a half-started
stack produces findings that are all about the stack.

`VERDICT: READY` → carry any `WARN:` lines into the agent prompt, so a known
quirk is not reported as a discovery.

## Step 3 — Build the test plan

Write the numbered cases **before driving anything**, per `qa-test-plan.md` §1.
Ask any batched expectation questions now.

## Step 4 — Dispatch

Hand the plan to the `qa-web` agent. It is a subagent for context cost: a single
accessibility-tree read can return tens of thousands of characters, and that
belongs in its context, not this one.

## Step 5 — Report

Write `docs/qa/<ID>.md`, evidence under
`docs/qa/evidence/<ID>/`:

```markdown
# QA: <ID>

**Recorded:** <ISO timestamp>
**Build verified:** <the artifact from the diff you confirmed was live>
**Cases:** <n executed> / <n planned>

## Summary
| # | Case | H/U | Result |

## Findings
## Not tested
## Left behind
```

Run the consistency check in `qa-test-plan.md` before writing. Then stop — this
skill reports; it does not fix.
