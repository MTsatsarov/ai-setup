# ai-setup

A Claude Code marketplace holding **claude-kit** — an interview-driven generator that
scaffolds a new project's running application *and* its matching per-project `.claude/` setup.

## Why

Setting up a new project used to mean `cp -r nextjs-shadcn/ <repo>/.claude/` and then editing
by hand. Two such payloads exist ([`nextjs-shadcn`](a hand-copied payload repo)
for NestJS+Drizzle, `the ABP payload` for ABP+EF Core) and they are the *same setup instantiated
twice* — identical skill slot names, identical agent skeleton, identical hooks modulo
string constants. Both have already drifted: their `CLAUDE.md` skill lists disagree with
their own agent frontmatter, because those lists are maintained in two places.

claude-kit makes the payload **generated**, from composable per-axis fragments. The
skill list appears in exactly one place — the resolved plan — so it cannot drift.

## Install

```bash
/plugin marketplace add MTsatsarov/ai-setup     # or a local path during development
/plugin install claude-kit@ai-setup
```

## Commands

| Command | Use |
|---|---|
| `/claude-kit:new-project [name]` | New repo — interview, then generate `.claude/` |
| `/claude-kit:add-setup [--force]` | Existing repo — detect the stack, confirm, generate |
| `/claude-kit:doctor [--library\|--project]` | Validate the library, or check a repo for drift |

## How it works

**Axes are questions. Fragments are answers. Slots are the skill files that answers own.**

```
answers.json ──► resolve.mjs ──► plan.json ──► render.mjs ──► .claude/
                 (all rules)                   (bytes only)
```

`backend-entities` is owned by the `orm` axis. Pick `drizzle` and its body is the
pgTable/`auditColumns`/`relations()` version; pick `efcore` and it is the
`FullAuditedEntity`/`IEntityTypeConfiguration` version. Same filename in the target repo,
same agent frontmatter entry, different content — and nothing downstream knows which.

A slot can also be **composed**: NestJS owns the `backend-service` body (module /
controller / service shape), while the ORM supplies the data-access blocks through the
`#provider` and `#crud_base` anchors. That split is what lets a future `orm/prisma` drop
in without forking the NestJS body.

### Currently supported

| Axis | Options |
|---|---|
| `backend-framework` | `nestjs`, `aspnet-core` |
| `orm` | `drizzle`, `efcore` |
| `auth` | `jwt`, `cookie-session`, `none` |
| `authz` | `rbac`, `none` |
| `mapping` | `automapper`, `mapster`, `manual` |
| `frontend-framework` | `nextjs-app`, `react-vite`, `angular`, `none` |
| `ui-kit` | `shadcn`, `mui`, `primeng`, `none` |
| `tracker` | `clickup`, `jira`, `none` |

`/claude-kit:new-project` **scaffolds the running application** (via the stack's own CLIs —
`nest new`, `dotnet new`, `create-next-app`, `create vite`, `ng new`) **and** generates the
matching `.claude/` payload. `tests/run.sh` resolves + renders every one of the **648** legal
axis combinations.

### Skills each answer generates

Two agents, each dropped when its axis is `none`: **`backend-developer`**
(`backend-framework`) and **`frontend-developer`** (`frontend-framework`). An agent's
`skills:` list is exactly the skills in its group — kept in one place, so it cannot drift.

**Backend** (under `backend-developer`):

| Skill | Owned by | Emitted when |
|---|---|---|
| `backend-entities` | orm | always |
| `backend-migrations` | orm | always |
| `backend-models` | backend-framework (+ mapping) | always |
| `backend-service` / `backend-module` | backend-framework | always — NestJS renames it to `backend-module` (controller+service+module folded together); ASP.NET keeps `backend-service` |
| `backend-controller` | backend-framework | ASP.NET only (NestJS folds the HTTP layer into `backend-module`) |
| `backend-code-quality` | backend-framework (+ orm, authz) | always |
| `backend-permissions` | authz (+ framework) | only when `authz = rbac` |

→ NestJS = **5** skills (6 with RBAC); ASP.NET = **6** (7 with RBAC).

**Frontend** (under `frontend-developer`):

| Skill | Owned by | Emitted when |
|---|---|---|
| `frontend-api-client` | frontend-framework | always |
| `frontend-pages` | frontend-framework | always |
| `frontend-forms` | frontend-framework (+ ui-kit) | always |
| `frontend-components` | ui-kit | only when `ui-kit ≠ none` |

→ with a UI kit = **4** skills; `ui-kit = none` = **3**; `frontend = none` = **0** and no frontend agent.

Skill *bodies* vary by choice: `frontend-pages` teaches App Router / React Router / Angular
routing; `frontend-components` teaches shadcn copy-in / MUI `sx`+theme / PrimeNG modules;
`backend-entities` is the Drizzle or the EF Core version — same filename, different content.
`auth`, `mapping` and `tracker` shape the skills above (and `CLAUDE.md`) through injected
sections rather than owning a skill of their own.

The floor is **0 skills** (backend + frontend both `none`); the ceiling is **11** (ASP.NET +
RBAC + any real frontend + any real UI kit).

Deferred: mobile axes and the workflow skills (`plan-task`, `implement-plan`, `pr`, …).

## Repo layout

```
.claude-plugin/marketplace.json
plugins/claude-kit/
  .claude-plugin/plugin.json
  skills/{new-project,add-setup,doctor}/SKILL.md   the plugin's own commands
  scripts/{resolve,render,validate-library}.mjs    resolve owns every rule
  scripts/scaffold.mjs                             runs the app CLIs + convention files
  scripts/lib/{erb,library}.mjs
  library/axes.json                                the interview
  library/slots.json                               slot -> owning axis
  library/base/                                    CLAUDE.md, agent, hook templates
  library/fragments/<axis>/<option>/               fragment.json + slots/ + sections/ + conventions/
  tests/                                           fixtures, golden trees, runner
```

## Development

```bash
cd plugins/claude-kit
./tests/run.sh              # erb units, library validation, golden diff, drift check
./tests/update-golden.sh    # accept current output as golden — review the diff
claude plugin validate .
```

`tests/run.sh` resolves **and renders every legal axis combination**, so a fragment that
references a variable no axis provides fails at authoring time rather than the first time
someone picks that combination.

### Adding a fragment

1. `library/fragments/<axis>/<option>/fragment.json` — `provides` for slots it owns,
   `contributes` for sections it adds to another axis's slot, `vars` for anything a
   template interpolates.
2. Bodies in `slots/`, sections in `sections/`. Use `<% axis.var %>` for anything
   stack-specific. Never hardcode a path another axis owns.
3. Add the option to `library/axes.json`.
4. `./tests/run.sh`.

Templates use `<% %>` rather than `{{ }}` because skill bodies legitimately contain
`{{name}}` (i18next) and `{{ item.name }}` (Angular). Unresolvable paths throw — a
silently empty variable is how a generator quietly produces a broken skill file.
