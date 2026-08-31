---
name: pr
description: Commit the verified change and open a draft pull request. Generates a Conventional Commits message from the diff, then hands off to pr.sh, which is the only thing permitted to push a new branch or create a PR.
argument-hint: <task id>
model: haiku
---

# /pr — Commit and Open a Draft PR

A thin wrapper. The mechanics live in `.claude/scripts/pr.sh` on purpose: one
choke point for creating a remote branch means "every PR this loop opens is a
draft" is a property of the system rather than a promise in prose.

Hold `.claude/skills/shared/safety-invariants.md` — invariants 2, 3, 5 and 6 are
all live here.

## Step 1 — Refuse on anything but PASS

```bash
.claude/scripts/plan-state.sh $ARGUMENTS get verify.verdict
```

Not `PASS` — or absent — means stop. Run `/verify-change full` first. Committing
on an unverified tree is invariant 3, and it is the one this skill is most
tempted to bend.

## Step 2 — Write the commit message

Read the diff and write a **Conventional Commits** subject: `feat:`, `fix:`,
`refactor:`, `chore:`, `test:`, `docs:`. Describe what changed and why, not which
files moved.

No `Co-Authored-By` trailer.

## Step 3 — Hand off

```bash
PR_NO_WEB=1 .claude/scripts/pr.sh "<task id>" "<branchSlug from state>" "<commit message>"
```

The script stages with an exclude pathspec for the artifact dirs, refuses to
commit if one is staged anyway, pushes, opens a **draft** PR, and writes
`prNumber` / `prUrl` / `branchName` / `stage=pr-open` into the state file.

## Step 4 — Report

Print the ` ```pr ` block verbatim, then:

```
Next: /pr-self-check <PR>
```

Do not mark the PR ready. That is invariant 6, and it is the author's call.
