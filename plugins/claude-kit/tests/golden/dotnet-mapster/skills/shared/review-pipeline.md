# Shared: Review Pipeline

**This is not a skill** — it is the review engine. The `pr-reviewer` agent
executes it on behalf of `/self-check`, `/pr-self-check` and `/review-pr`; they
differ only in what they do with the findings.

## Why a second pass exists at all

`.claude/scripts/verify.sh` proves the code **builds, lints and passes its
tests**. It has no opinion about whether the code is *correct*. All of these
pass the gate and none of them are acceptable:

- a new endpoint with no permission check
- a read that forgot the soft-delete filter
- a field added to the API and not to the client that consumes it
- logic that is simply wrong in a way the new tests also assume

This pipeline asks the question the gate cannot: **is it right?**

## Three contracts

**Output.** A flat list of findings. No severity tiers, no labels. Each finding
records `path`, `line` (the NEW side), an optional `start_line`, the quoted
problematic code, and the rule it violates named as `skill: rule` — for example
`backend-code-quality: soft-delete filter`. How findings are *phrased* is the
calling skill's concern, not the pipeline's.

**Completeness.** The pipeline alone determines the finding set. The same change
must yield the same findings regardless of which skill invoked it, and
regardless of who wrote the code — **reviewing your own work is held to the
identical standard, and is not a reason for leniency**. The calling skill
phrases and routes findings; it never filters, softens, or skips them.

**Worktree.** The pipeline never removes a worktree, whether it created it or
was handed it. Removing it is the caller's job, and only after the caller is
done with it. The main checkout is never touched — no branch switch, no stash.

## Dispatch — how a calling skill runs this pipeline

**A calling skill never executes this pipeline inline.** It dispatches the
`pr-reviewer` agent (Agent tool, `subagent_type: pr-reviewer`) with one of these
briefs, verbatim — fill the placeholders, add nothing:

```
Review PR #<PR>. Main repo: <absolute main checkout path>.
```

```
Review the working-tree change in <absolute path>. Main repo: <absolute main checkout path>.
```

For a re-review of a PR worktree the caller has since edited, append one line:

```
reuse-worktree <absolute worktree path>
```

Do **not** add the task id, the plan, the change's purpose, which skill is
asking, that the change is the caller's own, what an earlier round fixed, or any
instruction to focus on or skip something. Each of those changes the finding
set, and the Completeness contract forbids that. Resolve the main checkout with
`dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.

The agent returns the finding list in the format its definition
(`.claude/agents/pr-reviewer.md`) fixes. The caller takes those findings as they
are — it phrases and routes them, it never re-reviews, adds to or drops from
them.

## Step 0 — The code under review

**Working-tree mode** — `$WORKTREE` is the path in the brief. Review it as it
stands; create nothing.

**PR mode** — check the PR out in its own detached worktree, so LSP can analyse
the real code (the diff alone is not enough for Step 6) and the main checkout's
branch, index and uncommitted work stay exactly as they are:

```bash
gh pr view $PR --json title,headRefName,baseRefName
WORKTREE=~/repos/mapster-shop-worktrees/pr-$PR
git worktree remove --force "$WORKTREE" 2>/dev/null; git worktree prune   # a crashed run's leftover
git fetch origin "pull/$PR/head:refs/pr-review/$PR" --force
mkdir -p ~/repos/mapster-shop-worktrees
git worktree add --detach "$WORKTREE" "refs/pr-review/$PR"
git update-ref -d "refs/pr-review/$PR"
```

Detached, so no local branch is created that could collide with one checked out
elsewhere. A namespaced ref rather than `FETCH_HEAD`, so concurrent reviews do
not race.

**Round-2 reuse.** With `reuse-worktree <path>` in the brief, `$WORKTREE` is
that path. If `git worktree list` shows it, **skip the remove / fetch / add
block** and review the code as it now stands — the caller has just fixed things
there. Still run `gh pr view` for the branch names.

## Step 1 — Establish the change set

Run everything below in `$WORKTREE`. `<base>` is `origin/<baseRefName>` in PR
mode and `origin/main` in working-tree mode.

```bash
BASE=$(git -C "$WORKTREE" merge-base HEAD <base>)
git -C "$WORKTREE" diff --name-only "$BASE"                              # tracked
git -C "$WORKTREE" status --porcelain -uall | awk '$1=="??" {print $2}'  # untracked
git -C "$WORKTREE" diff "$BASE"                                          # the actual diff
```

**`-uall` is load-bearing.** Without it `git status --porcelain` collapses a new
directory into a single entry, and every file inside it — sources and tests
alike — is silently absent from the review.

**Untracked files are part of the change set** and are the easiest thing to lose.

**When only part of the branch is under review** — a run that started from a
clean tree, say — use `git diff HEAD` instead and say so in the report.
Reviewing ten thousand lines to find the fifteen hundred this run produced is
not more thorough, it is less: the finding set drowns.

Exclude from review: generated output, lockfiles, build artifacts, and
`docs/plans/**` / `docs/qa/**`.

## Step 2 — Classify changed files by area

- **Backend** — paths matching `^src/MapsterShop.Api/`, owned by `backend-developer`
- **Tests** — paths matching `^tests/`, owned by `backend-tester`

## Step 3 — Load the skills that govern what changed

This is what makes the review project-specific rather than generic. For every
area the change touches, read the relevant `.claude/skills/*/SKILL.md` **in
full** — they are the rules the findings cite. Always load the
`*-code-quality` skill for each area the change touches.

Read them from the main checkout, never from a review worktree: the worktree
holds the PR's version of the rules, and a PR that weakens a rule would then be
reviewed against its own weakened rule.

## Step 4 — Review the change against those skills

Every finding must name the rule it violates. A finding you cannot attribute to
a rule in a skill file, to a correctness bug, or to a test gap is an opinion —
and opinions are what make a review unactionable.

Beyond the skills, these are always in scope:

- **Correctness.** Off-by-one, wrong operator, an inverted condition, an
  unhandled null, a swallowed error.
- **Tests that cannot fail.** An assertion that holds regardless of the code
  under test is worse than no test: it reports success forever.
- **Logic changed with no test.** Backend behaviour with a decidable outcome and
  no test covering it is a finding.
- **Reuse.** When the change reimplements something that exists, **name the
  exact existing thing** — a finding that says "this probably exists somewhere"
  cannot be acted on.
- **Scope.** Changes unrelated to the stated task, and debug leftovers.

## Step 5 — Cross-cutting concerns

Check the seams, which are where single-file review is blind:

- a shared type or contract changed on one side only
- a permission added to one layer and not enforced in another
- a schema change with no matching migration
- user-facing strings added in one locale only
- separation of concerns: an area reaching into another area's responsibilities

## Step 6 — Impact analysis

For each changed shared symbol, use LSP `findReferences` and check that every
caller still holds. Skip this entirely for purely additive changes with no
existing callers — it is the most expensive step here and it finds nothing on
those.

## Step 7 — Known noise, never reported

- Anything `verify.sh` already reported as a failing step. That is the gate's
  job, and duplicating it doubles the finding count for one problem.
- Editor or LSP diagnostics the project's own compiler does not produce. The
  verdict block is the authority.
- **`CS0246` immediately after a large edit.** The type genuinely does not exist
  *yet* from the language server's point of view, because it is still indexing.
  The build is the authority — if `verify.sh` is green, there is no finding here.
