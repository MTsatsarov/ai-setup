---
name: list-skills
description: Lists every skill in this .claude/ setup with what each one does, grouped into commands you can type and reference skills the agents load. Generated from the SKILL.md frontmatter at run time, so it is never out of date. Use when the user says "/list-skills", "what skills do we have", "what commands are there", "what can you do", or is looking for the right skill for a task and does not know its name.
argument-hint: "[filter] [--full] — filter is a substring of a name or description; --full adds hints, full descriptions and bundled files"
---

# /list-skills — What This Setup Can Do

Answers "what have we got?" without opening every skill file. Every row comes
from the `SKILL.md` frontmatter, read at run time — so a skill added this
morning is in the list, and a renamed one is not. The hand-written rosters in
`README.md` and `CLAUDE.md` are for humans browsing the repo; **this** is the
one that cannot drift.

## Usage

```
/list-skills                    # everything, grouped
/list-skills migration          # only skills matching "migration"
/list-skills --full             # full descriptions, args, bundled files
/list-skills pr --full          # both
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filter`  | No | Case-insensitive substring matched against skill names **and** descriptions |
| `--full`  | No | Per skill: the complete description, the raw `argument-hint`, any `model:` override, the file path, and any bundled files |

## Step 1 — Run the script

```bash
.claude/scripts/list-skills.sh [filter] [--full]
```

It prints finished markdown. Pass the user's argument through as-is; `--full`
and a filter can be combined in either order.

## Step 2 — Print the output verbatim

Paste what the script produced. **Do not** rewrite the rows, reorder the
groups, re-summarize a description in your own words, or add a skill you
remember from elsewhere in the conversation. The script read the files; a row
you rephrased is a description that no longer matches the skill it names,
which is precisely the failure this command exists to prevent.

Add at most one sentence of your own afterwards, and only if the user asked
something the table does not answer.

## Step 3 — If the user asked *which* skill to use, not for the list

Re-run with `--format=tsv`, reason over the rows, then recommend one and say
why. Still never invent a skill: if nothing fits, say nothing fits and suggest
the closest manual route.

```bash
.claude/scripts/list-skills.sh --format=tsv
# group⇥name⇥invocation⇥purpose⇥arghint⇥model⇥path⇥bundled
```

## How the grouping is derived

Nothing here is a maintained list — every decision falls out of frontmatter
that already exists:

| Group | Rule |
|---|---|
| **Commands** | the skill has an `argument-hint`, i.e. you type `/<name>` |
| **Backend reference** | no hint, name starts `backend-` — the agents load it |
| **Frontend reference** | no hint, name starts `frontend-` |
| **Shared reference** | everything else |

## Rules

- **Never** substitute `ls .claude/skills/` for the script. A directory listing
  gives names with no explanation, which is the half the user did not ask for.
- **Never** fall back to the skills list in `README.md` or `CLAUDE.md` — those
  are the lists that go stale.
- `skills/shared/*.md` are includes other skills read, not runnable skills. The
  script names them in a footer; do not present them as things to invoke.
- Read-only: the script only reads `SKILL.md` files. It never needs approval, a
  network call or an MCP server.
