---
name: new-project
description: Scaffold a new project — interview the user about their stack (backend framework, ORM, frontend, auth, authorization, task tracker), then generate a complete .claude/ setup with CLAUDE.md, a backend-developer agent, stack-specific skills, protective hooks and settings.json.
argument-hint: "[project-name] — optional; you will be asked if omitted"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Scaffold a new project

Generate a project's `.claude/` payload by interviewing the user and assembling
composable per-axis fragments. Everything stack-specific lives in the library;
your job is to run the interview and drive the scripts.

`$ARGUMENTS` may contain the project name.

## Phase 0 — Preflight

```bash
pwd && ls -A
```

- If the directory already contains a `.claude/` payload, **stop** and tell the user to
  use `/claude-kit:add-setup --force` instead — that command is built for existing repos.
- If the directory is non-empty in other ways, say so and confirm before continuing.
  Do not delete anything.

## Phase 1 — Interview

Read the library's question set. Never invent axes or options — the library is the
only source of truth for what is supported:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/library/axes.json"
for f in "${CLAUDE_PLUGIN_ROOT}"/library/fragments/*/*/fragment.json; do
  node -e 'const d=require(process.argv[1]);console.log([d.id,d.label,d.description??"",JSON.stringify(d.requires??{}),JSON.stringify(d.implies??{})].join("\t"))' "$f"
done
```

Then ask the axes **in `axes.json` order**, using `AskUserQuestion` with the axis's
`header` and `question`, and each fragment's `label` and `description` as the options.

Two rules make this a short interview rather than an interrogation:

- **Skip an axis whose options are already narrowed to one.** Filter each axis's options
  by the `requires` of its fragments against the answers so far. If exactly one survives,
  select it silently and report it in Phase 4 rather than asking.
- **Skip an axis pinned by `implies`.** If an already-chosen fragment implies a value for
  a later axis, that axis is decided. Report it; do not ask.

Also collect, in one final `AskUserQuestion` or as plain follow-up questions:

- **project name** (from `$ARGUMENTS` if given)
- **notification title** — defaults to the project name
- **repo slug** and **github user** — optional, blank is fine

## Phase 2 — Write the answers

```bash
mkdir -p .claude-kit
```

Write `.claude-kit/answers.json`:

```json
{
  "project": {
    "name": "<name>",
    "notification_title": "<title>",
    "repo": "<owner/repo or empty>",
    "github_user": "<user or empty>"
  },
  "answers": { "<axis-id>": "<option>", "...": "..." }
}
```

Include every axis you asked **and** every axis that was auto-selected.
`slug` and `pascal` are derived automatically — do not set them.

## Phase 3 — Resolve

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve.mjs" \
  --answers .claude-kit/answers.json --out .claude-kit/plan.json
```

A non-zero exit means the answers are incompatible. The message names the specific
rule. Fix it by re-asking the offending axis — never by hand-editing `plan.json`.

## Phase 4 — Confirm

Show the user, from the resolver's output:

- the resolved fragment set,
- anything **auto-selected** on their behalf and which fragment forced it,
- the skills and agents about to be written.

Ask for confirmation before writing.

## Phase 5 — Application code

Not implemented yet. `.claude/` is generated; the app itself is not scaffolded.
Tell the user plainly that they still need to create the application (e.g. `nest new`),
and that the generated skills describe the conventions that code should follow.

## Phase 6 — Generate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" \
  --plan .claude-kit/plan.json --out .claude --clean
```

Hooks are written executable; no `chmod` step is needed.

## Phase 7 — Report and offer to commit

Summarize what was written. Then offer — do not assume:

- `git init` plus a first commit, if this is not already a repo.
- Committing `.claude-kit/answers.json`. Recommend yes: it records the stack decisions
  and lets a future regeneration reuse them. Mention that it stores the repo slug and
  tracker choice, which matters if the repo will be public.

## Rules

- Ask only what the library actually offers. If the user wants a stack that has no
  fragment, say so directly and suggest `/claude-kit:doctor --library` to see what exists.
  Do not fake it by picking the nearest option.
- Never hand-write a skill, agent, hook or CLAUDE.md. Everything under `.claude/` is
  generated — hand-edits are exactly the drift this tool exists to eliminate.
- Never edit `plan.json`. It is derived; fix the answers instead.
