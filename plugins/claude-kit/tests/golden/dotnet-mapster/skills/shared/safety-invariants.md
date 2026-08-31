# Shared: Safety Invariants

**This is not a skill** — it is the canonical list of what a loop-driven run may
never do. Every workflow skill in `.claude/skills/` defers to it.

## Why this file exists

These rules are the difference between an autonomous run and an unsupervised
one. They have to live in **one** file: in the repos this setup was ported from,
the same rule was written out in four places — `CLAUDE.md`, two skills, and the
post-compact hook — each with slightly different wording, and three of the four
copies had drifted to a command that could not succeed at all.

Four copies is how three of them go stale. One list. Everything else points here.

## The invariants

1. **Never run destructive git.** No `checkout` (except `-b`), `switch` (except
   `-c`), `restore`, `stash`, `clean`, `reset --hard`, or reverse-patch. A tree
   mid-run carries uncommitted work that exists nowhere else. To undo an edit,
   revert it with the Edit tool.

2. **Never stage or commit `docs/plans/**` or `docs/qa/**`.**
   They are working artifacts, deliberately *not* git-ignored so they stay
   visible in `git status` — which makes keeping them out of the index an active
   rule rather than something git does for you. That also means a blanket
   `git add -A` stages them; use an explicit exclude pathspec:
   `git add -A -- ':/' ':(exclude)docs/plans' ':(exclude)docs/qa'`

3. **Never commit or push on a non-`PASS` verdict.** `.claude/scripts/verify.sh`
   is the only thing that decides, and a `FAIL` is a stop, not a suggestion. In
   an unattended run it is a stop in the literal sense: write a `push-blocked`
   stop record and halt the loop. Do **not** downgrade it to a question — nobody
   is reading the terminal, so an unanswered question is just the run stalling
   with its reason unrecorded.

4. **Never reach green by disabling a check.** No deleted, skipped or `xit`-ed
   tests, no loosened assertions, no `@ts-ignore` / `@ts-expect-error`, no
   widening to `any`, no `eslint-disable`, no `#pragma warning disable`, no
   `--no-verify`. If that is the only path you can see, stop and report it —
   that is the correct outcome, not a failure of the loop.

5. **Never force-push. Never push to `main`.** An
   unattended rewrite of a remote branch is unrecoverable. Changes reach the
   base branch through a pull request.

6. **The PR is always opened as a draft.** Never run `gh pr ready`
   automatically — marking a PR ready for review is a claim about your
   confidence, and it is not yours to make.

7. **Never hand-edit generated files.** Regenerate them with the tool that owns
   them. Editing generated output to match hand-written code inverts the
   dependency and the next regeneration silently discards the fix.

8. **Never auto-apply a finding that needs an author decision.** The loop's
   autonomy covers mechanical fixes to a named failing check. It never covers
   deciding what the product should do.

9. **Never mix areas.** `Backend` → `backend-developer`, `Tests` → `backend-tester`.
   A failing check in one area is never handed to another area's agent, whatever
   the root cause turns out to be.

10. **Every halt writes its reason to a file before printing it.** See
    `.claude/skills/shared/stop-record.md`. A reason that exists only in the
    terminal is lost to a compact, a closed session, or simply walking away for
    the twenty minutes a run takes.

11. **On any abort, leave the worktree in place.** It holds the only copy of the
    work. Removing it to tidy up destroys the thing the stop record points at.

12. **The run report never goes in the pull request.** It is written for the
    author, in `docs/plans/`. A report with nowhere to go does not
    evaporate — it gets put somewhere, and the nearest writable surface is the
    PR description.

## What enforces what

Prose is the weakest layer. Where a rule is also enforced mechanically, that is
noted below — and where it is not, the prose is all there is.

| Invariant | Mechanical enforcement |
|---|---|
| 1 destructive git | `hooks/protect-plan-artifacts.sh` (PreToolUse, Bash) |
| 2 artifacts | same hook — both the named-path and the blanket-stage guards |
| 5 force-push / base-branch push | same hook |
| 7 generated files | `hooks/protect-migrations.sh` |
| 7 generated files | `hooks/protect-generated-files.sh` |
| 3, 4, 6, 8, 9, 10, 11, 12 | **prose only** |

The hook ships with a fixture. Run it after **any** edit to its patterns:

```bash
.claude/hooks/test-protect-plan-artifacts.sh
```

That fixture is not optional politeness. A PreToolUse hook that errors exits 2,
which the harness reads as *blocked* — so a guard broken by a stray character
looks exactly like a working one until the day it blocks something you needed.
