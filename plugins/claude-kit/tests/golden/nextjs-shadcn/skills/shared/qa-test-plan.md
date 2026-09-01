# Shared: QA Test Plan

**This is not a skill** — it is the discipline the QA agent follows. It is
stack-independent on purpose: whatever machinery a QA pass drives, this is the
part that must not diverge.

## Why a QA pass needs rules at all

Every rule below exists because its absence produced a **wrong finding** — or,
worse, a wrong report:

| The trap | What it looks like | What it actually is |
|---|---|---|
| Stale build | every case passes | you tested the previous commit |
| Pre-existing console noise | a wall of red | someone else's warning from months ago |
| Empty fixtures | "the list screen is broken" | nobody seeded the database |
| A rate limit | "login is broken" | you signed in forty seconds ago |
| A passing screenshot | PASS | the request 500'd and the UI swallowed it |

## 1 — Plan before you touch anything

Write the numbered cases first, each tagged `[H]` happy or `[U]` unhappy,
ordered by screen, read-only cases before mutating ones.

```
#3  [U]  /admin/customers/new — name over 200 chars
    Steps:    open the form, paste 201 chars into name, submit
    Expected: inline error under the field, no request sent, no toast
```

Derive cases from the diff — which screens it touches, which behaviours it
changes, and which *other* consumers of a changed endpoint need a regression
case. `Expected` comes from the plan, the acceptance criteria or the code, never
from your own sense of what would be nicer.

Where the expectation is genuinely unclear, collect **every** such gap across
**all** cases and ask them in one batch, up front.

## 2 — Cover both paths; the unhappy one is the point

Validation · authorization · conflict · not found · backend down · expired
session · interrupted flow · empty state · boundary values.

## 3 — Prove you are testing the right build, first, always

**Before case #1**, pick one unmistakable artifact from the diff and confirm it
is present in the running app. If it is absent, **stop** — the app is serving a
different build and every result after this point is meaningless.

This is the single highest-value rule here. Everything else catches a wrong
finding; this one catches an entire wrong report.

## 4 — Baseline the noise, then measure the delta

Record the console and network state before you start. A new JavaScript error or
a failed 4xx/5xx request **is a finding even when the UI looks fine** — and a
pre-existing one is not yours.

## 5 — Mutate as little as possible, and clean up

Prefix anything you create with `QA-TEST-`. Never run a destructive git command,
and never seed or reset the database.

## 6 — Fast-exit on a blocker

Grinding through fifteen cases that all fail for the same reason produces
fifteen findings that are really one, and buries it.

## 7 — Report; never fix

A QA agent has no plan behind it, no verify loop, and no separation-of-concerns
boundary once it starts editing. Findings go in the report; fixing them is a
separate, supervised act.

### Finding format

```
### F2 — <title>  [U, case #7]
Where:    <url / screen>
Steps:    <numbered, reproducible>
Expected: <from the plan or the code>
Actual:   <what happened>
Evidence: <screenshot path, console line, request>
```

## Regenerate the report after any interruption

If you retry, reconnect, or resume after **any** interruption, **regenerate the
report from scratch.**

This is not hypothetical. A real run wrote a report saying "BLOCKED, 0 of 20
executed", then reconnected and actually executed seven cases with five
screenshots — and never rewrote the report. The tree ended up holding evidence
from a real run beside a report claiming no run happened. Every case in it was
wrong, and nothing caught it.

Before writing the report, check consistency:

```bash
ls docs/qa/evidence/<ID>/ | wc -l
```

A non-empty evidence directory and a report claiming 0 executed cannot both be
true. **The screenshots are the ground truth.**
