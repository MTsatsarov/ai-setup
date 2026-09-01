## Project: React Shadcn

### Tech Stack
- **Backend:** ASP.NET Core (C#) — source at `src/ReactShadcn.Api`, one folder per feature under `Features/`
- **ORM:** Entity Framework Core, PostgreSQL — entities beside their feature, EF configurations at `src/ReactShadcn.Api/Data/Configurations`, generated migrations at `src/ReactShadcn.Api/Data/Migrations` (never hand-edited)
- **Auth:** JWT bearer tokens — stateless, sent in the `Authorization` header
- **Authorization:** role-based (RBAC) — deny-by-default, roles checked declaratively at the endpoint
- **Mapping:** AutoMapper — one `Profile` per feature, reads projected with `ProjectTo`
- **Frontend:** React (Vite) — client-rendered SPA, source at `apps/web/src`, styled with shadcn/ui + Tailwind

### Key Rules
- Backend and frontend are **separate concerns** — never mix them in a single agent
- No business logic in controllers — controllers delegate to a scoped service
- Request models are validated before the service is reached; services assume valid input
- A listing endpoint's query surface is exactly what the service's `Filterable`/`Sortable` allowlists declare — never widen one without meaning to
- Soft delete is enforced by a global query filter on the DbContext — never call `Remove(entity)`, set `IsDeleted` instead
- CRUD lives in `CrudService<TEntity, TId, TCreate, TUpdate, TListRequest, TListItem>` — derive from it rather than re-writing paging, filtering or sorting per feature
- Never hand-edit files under `Data/Migrations/` — change the entity and run `dotnet ef migrations add`
- Endpoints are authenticated by JWT bearer token; the fallback policy denies anonymous access unless an endpoint opts out with `[AllowAnonymous]`
- Authorization is role-based and deny-by-default — a new endpoint is closed unless it explicitly opts out
- Frontend and backend are **separate concerns** — never mix them in a single agent
- This is a client-rendered SPA — there are no Server Components; every component runs in the browser

### Agents
- `backend-developer` — C# backend only — ASP.NET Core controllers, scoped services, EF Core entities and migrations, DTOs. Never touches frontend code.
- `frontend-developer` — React (Vite) SPA frontend only — route components, the API client, React Router, and forms. Never touches backend code.
- `backend-tester` — C# backend tests only — xUnit test projects under tests/. Writes tests for code it did not write, and never edits production code to make one pass.
- `qa-web` — Drives the running app in a real browser to execute a QA test plan. Reports findings with evidence; never edits code.

### Skills

**Backend**
- `backend-code-quality`
- `backend-controller`
- `backend-entities`
- `backend-migrations`
- `backend-models`
- `backend-permissions`
- `backend-service`
- `backend-tests`

**Workflow**
- `create-task`
- `implement-plan`
- `manual-qa`
- `plan-task`
- `pr`
- `pr-self-check`
- `pr-watch`
- `review-pr`
- `self-check`
- `ship`
- `verify-change`

**Frontend**
- `frontend-api-client`
- `frontend-components`
- `frontend-forms`
- `frontend-pages`

### Branching

`<github-user>/<task-id>/<branch-slug>`, off `main`.
Created by `.claude/scripts/pr.sh`, which is the only thing permitted to push a
new branch or open a PR — and every PR it opens is a draft.

### The loop

```
/loop /ship PROJ-123
```

One stage per invocation, each in a fresh context, re-armed by `ScheduleWakeup`:

```
(no state) → planned → implementing → verified → pr-open → self-checked → ready
          ↘ (any boundary) ─────────────────────────────────────────────→ stopped
```

Every stage can also be run by hand: `/plan-task` → `/implement-plan` →
`/verify-change` → `/pr` → `/pr-self-check` → `/loop 15m /pr-watch`.

Two rules carry the whole design:

- **`.claude/scripts/verify.sh` is the only thing that decides whether a change
  works.** Never run the underlying build, lint or test commands by hand and
  judge the output yourself. Only its `VERDICT:` block counts.
- **Attempt counters live in `docs/plans/<ID>.state.json`, never in
  your head.** A compact resets what is only in context, which is exactly the
  runaway a bounded loop exists to prevent — read them back before continuing.

`docs/plans/**` and `docs/qa/**` are working artifacts.
They are deliberately **not** git-ignored, so they stay visible in `git status`
and keeping them out of the index stays an active decision.

### Loop Safety Invariants

The canonical list is `.claude/skills/shared/safety-invariants.md`. Everything
defers to it; this is a pointer, not a second copy. The four that matter most:

1. **Never run destructive git** — no `checkout`/`restore`/`stash`/`clean`/`reset --hard`.
2. **Never stage or commit `docs/plans/**` or `docs/qa/**`.**
3. **Never commit or push on a non-`PASS` verdict.**
4. **Never reach green by disabling a check.**

Invariants 1, 2 and 5 are enforced by `.claude/hooks/protect-plan-artifacts.sh`.
The rest are prose — which is exactly why they are written down once.


<!--
  This file is generated by claude-kit. The Agents and Skills lists above are
  derived from the resolved fragment set, so they cannot drift from what is
  actually in .claude/agents/ and .claude/skills/. Re-run the generator rather
  than editing those lists by hand.
-->
