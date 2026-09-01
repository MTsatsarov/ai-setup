# ai-setup

A Claude Code marketplace holding **claude-kit** — an interview-driven generator that
scaffolds a new project's running application *and* its matching per-project `.claude/` setup.

## Why

Setting up a new project used to mean `cp -r <some-other-repo>/.claude/ .` and then
editing by hand. Keep two such payloads — say one for NestJS+Drizzle and one for
ABP+EF Core — and you have the *same setup instantiated twice*: identical skill slot
names, identical agent skeleton, identical hooks modulo string constants. Both drift.
Their `CLAUDE.md` skill lists end up disagreeing with their own agent frontmatter,
because those lists are maintained in two places.

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
`AuditedEntity`/`IEntityTypeConfiguration` version. Same filename in the target repo,
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

Beyond the CLI output, the scaffold lays down the house conventions as **real source files** —
soft-delete-aware entities, the DbContext/Drizzle wiring, and a generic CRUD base:

```
CrudService<TEntity, TId, TCreateRequest, TUpdateRequest, TListRequest, TListItem>
  GetListing(TListRequest) -> PagedResult<TListItem>   // page, filter, sort
  Create(TCreateRequest)   -> TId
  Update(TUpdateRequest)   -> TId                      // id travels on the model
  Delete(TId)                                          // soft delete
```

Listing requests extend a shared base carrying `Page`, `PageSize`, `Filters` and `Sorters`;
the base applies all three, but only over the fields a service allowlists, so adding a column
never silently widens its API. Both backends get the same contract — EF Core via expression
trees, Drizzle via typed column maps.

### Skills each answer generates

Four agents, each dropped when its axis is `none`: **`backend-developer`** and
**`backend-tester`** (`backend-framework`), **`frontend-developer`** and
**`qa-web`** (`frontend-framework`). An agent's `skills:` list is exactly the
skills in its group — kept in one place, so it cannot drift. Workflow skills
belong to no agent, which is the one deliberate exception.

**Backend** (under `backend-developer`):

| Skill | Owned by | Emitted when |
|---|---|---|
| `backend-entities` | orm | always |
| `backend-migrations` | orm | always |
| `backend-models` | backend-framework (+ mapping) | always |
| `backend-service` / `backend-module` | backend-framework | always — NestJS renames it to `backend-module` (controller+service+module folded together); ASP.NET keeps `backend-service` |
| `backend-controller` | backend-framework | ASP.NET only (NestJS folds the HTTP layer into `backend-module`) |
| `backend-code-quality` | backend-framework (+ orm, authz) | always |
| `backend-tests` | backend-framework (+ orm) | always — owned by the `backend-tester` agent, because an implementer writing its own tests writes tests that agree with it |
| `backend-permissions` | authz (+ framework) | only when `authz = rbac` |

→ NestJS = **6** skills (7 with RBAC); ASP.NET = **7** (8 with RBAC).

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

Plus the **9 workflow skills** every project gets, and two more that are
conditional: `create-task` with a tracker, `manual-qa` with a frontend.

So a generated payload ranges from **16 skills** (NestJS, no frontend, no
tracker) to **24** (ASP.NET + RBAC + a real frontend and UI kit + a tracker).

### The loop

Beyond stack knowledge, every generated payload carries a **closed loop**: a
resumable stage machine that takes a task from a sentence to a reviewed draft PR.

```
/loop /ship "punch cards should expire a year after the last visit"

(no state) → planned → implementing → verified → pr-open → self-checked → ready
          ↘ (any boundary) ─────────────────────────────────────────────→ stopped
```

Four properties, each earned from a failure the naive version hits:

| Property | Mechanism | Failure it prevents |
|---|---|---|
| One definition of done | `scripts/verify.sh` prints a `VERDICT:` block and is the only thing allowed to decide | the model marking its own homework |
| Durable counters | written to `docs/plans/<id>.state.json` **before** each attempt | a compact silently granting 3 fresh attempts |
| One stage per invocation | each stage ends the turn and re-arms via `ScheduleWakeup` | a mega-context that compacts mid-run |
| Durable stops | the reason is written to a file before it is printed | an unattended run stalling with its reason in lost scrollback |

Underneath sits `skills/shared/safety-invariants.md` — one canonical list, with
an explicit table of which rules a hook enforces and which are only prose.

**Workflow skills** (`Workflow` group, owned by no axis, driven by you or by
`/loop`): `plan-task`, `implement-plan`, `verify-change`, `self-check`, `pr`,
`pr-self-check`, `pr-watch`, `review-pr`, `ship` — plus `create-task` when there
is a tracker and `manual-qa` when there is a frontend.

**With no tracker**, the loop is ticket-less rather than degraded: the task is
described on the command line, the id is a slug derived from it, branches are
two segments instead of three, and there is no drift check because nothing
external can change underneath the run.

`verify.sh`, `plan-state.sh`, `pr.sh` and `statusline.sh` are generated too —
`verify.sh`'s legs come from each fragment's declared steps, so adding an ORM or
a frontend extends the gate rather than forking it.

Deferred: mobile axes, and device/emulator QA.

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
  library/base/                                    CLAUDE.md, README, agent, hook templates
  library/base/skills/                             the workflow loop + shared/ includes
  library/base/scripts/                            verify.sh, plan-state.sh, pr.sh, statusline.sh
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
