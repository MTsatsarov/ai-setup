---
name: review-pr
description: Review someone else's pull request and post the findings as inline comments. Same review engine as /self-check, but it reports rather than fixes, and never posts without explicit approval.
argument-hint: <PR number>
---

# /review-pr — Review Someone Else's PR

Same pipeline as `/self-check`; opposite terminal state. This one **never edits
code**. It reports.

## Step 1 — Run the pipeline

Read `.claude/skills/shared/review-pipeline.md` in full and execute it over the
PR diff. It creates the review worktree; removing it is this skill's job, after
posting or declining.

## Step 2 — Phrase the findings

Findings arrive from the pipeline as facts. Turn each into a comment that a
person can act on without a follow-up question:

- **One point per comment**, anchored to the narrowest line range that shows it.
- **Say what to do, not how you feel about it.** "Filter out deleted rows here"
  beats "this looks wrong".
- **Cite the rule** when the project has one — the skill file and the rule name.
- **Ask, when you are genuinely unsure.** A question the author can answer in
  one line is worth more than a confident wrong instruction.
- **No praise comments, no nits about formatting a formatter owns.** Both train
  the author to skim.

Deduplicate against comments already on the PR. Re-posting a point someone else
made is how a review of twelve findings becomes thirty comments.

## Step 3 — The approval gate

Print every comment you intend to post, with its file and line, and end the turn
with:

```
Reply: **post** · comment numbers (e.g. **1,3**) · **cancel**
```

**Never post without an explicit reply.** The report must be the final message
of the turn.

## Step 4 — Post

Post the approved comments as a single review. Request changes only when at
least one finding is a correctness bug or a violated project rule; otherwise
leave the review as comments.

Then remove the review worktree.
