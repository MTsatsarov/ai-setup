---
name: add-setup
description: Add a .claude/ setup to an EXISTING repository. Detects the stack from package.json, lockfiles, project files and folder layout, confirms the detected choices with the user, then generates CLAUDE.md, agents, skills, hooks and settings.json. Never modifies application code.
argument-hint: "[--force] — overwrite an existing .claude/ payload"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Add a claude-kit setup to an existing repo

Same engine as `/claude-kit:new-project`, but the stack is **detected and confirmed**
rather than chosen from scratch. This never touches application code.

## Phase 0 — Preflight

```bash
pwd && ls -A && ls -A .claude 2>/dev/null
```

If `.claude/` already exists and `$ARGUMENTS` does not contain `--force`, stop and
report what is there. Overwriting someone's hand-written setup without asking is
not recoverable for them.

If `.claude-kit/answers.json` already exists, this repo was generated before — read it,
show the recorded answers, and offer to reuse them as the starting point.

## Phase 1 — Detect

Look for evidence, and record which file each conclusion came from:

| Axis | Evidence to look for |
|---|---|
| `backend-framework` | `@nestjs/core` in a `package.json`; a `.csproj`/`.sln`; `Volo.Abp.*` packages |
| `orm` | `drizzle-orm` + `drizzle.config.ts`; `Microsoft.EntityFrameworkCore`; a `Migrations/` or `drizzle/` folder |
| `frontend-framework` | `next` + an `app/` directory; `@angular/core` + `angular.json` |
| `ui-kit` | `components.json` + `tailwindcss`; `primeng` |
| `auth` | `passport`/`jsonwebtoken`; ABP account modules |
| `tracker` | task ids in recent commit messages (`git log --oneline -30`) |

Useful sweeps:

```bash
find . -maxdepth 3 \( -name package.json -o -name '*.csproj' -o -name angular.json \) -not -path '*/node_modules/*'
git log --oneline -30 2>/dev/null
```

Check detected values against what the library actually supports:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/library/axes.json"
```

## Phase 2 — Confirm every detection

Present findings with their evidence and confirm via `AskUserQuestion` — one question
per axis you are **not** confident about, and a single summary confirmation for the rest.

State detections as evidence, not conclusions: "`apps/api/package.json` depends on
`@nestjs/core`, so I read the backend as NestJS." If evidence is missing for an axis,
ask outright rather than guessing.

For any axis the library does not support, say so and stop — do not substitute the
nearest available option.

## Phase 3 — Generate

Identical to `/claude-kit:new-project` phases 2, 3, 4 and 6:

```bash
mkdir -p .claude-kit
# write .claude-kit/answers.json from the confirmed answers
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve.mjs" \
  --answers .claude-kit/answers.json --out .claude-kit/plan.json
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" \
  --plan .claude-kit/plan.json --out .claude --clean
```

Preview first when overwriting, so the user sees the blast radius before it happens:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --plan .claude-kit/plan.json --dry-run
```

## Phase 4 — Reconcile with reality

The generated skills describe conventions — base CRUD service, shared audit columns,
folder layout. The repo may not have them yet.

Spot-check a few paths the skills reference and **report honestly** which exist and
which do not. Do not create them; do not quietly reword the skills to match the repo.
Offer to open follow-up work for the gaps.

## Rules

- `--force` overwrites `.claude/` only. A sibling `settings.local.json` is never in scope.
- Never modify application code from this command.
- Never hand-edit generated files to paper over a detection mismatch — fix the answer
  and regenerate.
