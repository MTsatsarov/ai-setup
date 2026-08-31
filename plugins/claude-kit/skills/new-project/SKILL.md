---
name: new-project
description: Create a new project — interview the user about their stack (backend framework, ORM, frontend, auth, authorization, task tracker), then generate both the running application (via the stack's own CLIs) and a complete .claude/ setup with CLAUDE.md, agents, stack-specific skills, protective hooks and settings.json.
argument-hint: "[project-name] — optional; you will be asked if omitted"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Create a new project

Interview the user, then produce two things from the same resolved plan: the
application itself (scaffolded with the stack's own CLIs) and its `.claude/`
payload, assembled from composable per-axis fragments. Everything stack-specific
lives in the library; your job is to run the interview and drive the scripts.

`$ARGUMENTS` may contain the project name.

## Phase 0 — Locate the kit, then preflight

Resolve the plugin root **once** and use the resulting absolute path literally in every
later command — each Bash call is a fresh shell, so an exported variable will not survive.

```bash
KIT="${CLAUDE_PLUGIN_ROOT:-}"
[ -f "$KIT/scripts/resolve.mjs" ] || KIT=$(find ~/.claude/plugins/marketplaces -maxdepth 3 -type d -name claude-kit 2>/dev/null | head -1)
[ -f "$KIT/scripts/resolve.mjs" ] || { echo "cannot locate claude-kit — is the plugin installed?"; exit 1; }
echo "KIT=$KIT" && node --version
pwd && ls -A
```

If that fails, stop and say so plainly rather than guessing a path. The user can pass one
explicitly (`/claude-kit:new-project --kit /path/to/plugins/claude-kit`); honour it if given.

- If the directory already contains a `.claude/` payload, **stop** and tell the user to
  use `/claude-kit:add-setup --force` instead — that command is built for existing repos.
- If the directory is non-empty in other ways, say so and confirm before continuing.
  Do not delete anything.

## Phase 1 — Interview

Read the library's question set. Never invent axes or options — the library is the
only source of truth for what is supported:

```bash
cat "$KIT/library/axes.json"
for f in "$KIT"/library/fragments/*/*/fragment.json; do
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
- **repo slug** and **github user** — the github user appears in the documented
  branch convention `{github_user}/{task-id}/{slug}`; `pr.sh` itself reads the
  real login from `gh api user` at runtime, so a blank one renders a visible
  `<github-user>` placeholder rather than breaking anything. Offer
  `gh api user --jq .login` as the default.
- **base branch** — defaults to `main`. The generated `pr.sh` targets it, the
  artifact hook refuses direct pushes to it, and `verify.sh` diffs against it

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
    "github_user": "<user or empty>",
    "base_branch": "<main, or the project's base branch>"
  },
  "answers": { "<axis-id>": "<option>", "...": "..." }
}
```

Include every axis you asked **and** every axis that was auto-selected.
`slug` and `pascal` are derived automatically — do not set them. `plans_dir`
and `qa_dir` default to `docs/plans` and `docs/qa`; set them only if the project
already uses different paths.

## Phase 3 — Resolve

```bash
node "$KIT/scripts/resolve.mjs" \
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

## Phase 5 — Generate `.claude/`

```bash
node "$KIT/scripts/render.mjs" \
  --plan .claude-kit/plan.json --out .claude --clean
```

Hooks are written executable; no `chmod` step is needed.

This runs **before** scaffolding on purpose: rendering is offline and cannot fail,
so a scaffold that dies halfway still leaves a usable payload behind.

## Phase 6 — Application code

Show the user what will run, then run it.

```bash
node "$KIT/scripts/scaffold.mjs" \
  --plan .claude-kit/plan.json --root . --dry-run
```

Show that output verbatim — it is the exact command list, in execution order, plus
the convention files that will be written. Ask **once** for confirmation. On yes:

```bash
node "$KIT/scripts/scaffold.mjs" --plan .claude-kit/plan.json --root .
```

Then run each `build` in `plan.json`'s `verify` array and report the result honestly.

If a command fails, the script stops and prints the failing step. Report that step and
its output verbatim, then stop. Do **not** improvise a fix, skip the step, or re-run
with different flags — a scaffold failure usually means a fragment is wrong, and that
belongs in the library, not in a one-off workaround. `--from <n>` resumes after the
user has fixed the cause.

The script refuses to run in a non-empty directory. That guard is deliberate; do not
pass `--force` to get around it without the user explicitly asking.

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
