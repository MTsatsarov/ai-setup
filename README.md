# ai-setup

A Claude Code marketplace holding **claude-kit** — an interview-driven generator for
per-project `.claude/` setups.

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
| `backend-framework` | `nestjs` |
| `orm` | `drizzle` |
| `frontend-framework` | `nextjs-app`, `angular`, `none` |
| `ui-kit` | `shadcn`, `primeng`, `none` |
| `auth` | `session-jwt`, `none` |
| `authz` | `none` |
| `tracker` | `clickup`, `jira`, `none` |

Backend slots: `backend-entities`, `backend-migrations`, `backend-models`,
`backend-service` (emitted as `backend-module`), `backend-code-quality`.

Frontend axes are asked and feed `CLAUDE.md`, but own no skill bodies yet.
`abp-dotnet` + `efcore` are next; frontend slots and the workflow skills
(`plan-task`, `implement-plan`, `pr`, …) follow.

Application-code scaffolding (`nest new`, `dotnet new abp`) is **not** implemented —
today claude-kit generates the `.claude/` payload only.

## Repo layout

```
.claude-plugin/marketplace.json
plugins/claude-kit/
  .claude-plugin/plugin.json
  skills/{new-project,add-setup,doctor}/SKILL.md   the plugin's own commands
  scripts/{resolve,render,validate-library}.mjs    resolve owns every rule
  scripts/lib/{erb,library}.mjs
  library/axes.json                                the interview
  library/slots.json                               slot -> owning axis
  library/base/                                    CLAUDE.md, agent, hook templates
  library/fragments/<axis>/<option>/               fragment.json + slots/ + sections/
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
