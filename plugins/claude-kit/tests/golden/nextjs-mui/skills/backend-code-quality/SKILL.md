---
name: backend-code-quality
description: Use as a checklist after implementing backend code. Covers SOLID/async rules, providers behind interfaces, DTO validation, guards, query hygiene, and error handling.
---

# Skill: Backend Code Quality Rules

## SOLID & Clean Code
- Follow SOLID principles
- Extract duplicated logic into methods/providers
- Avoid nested loops — minimize complexity
- Depend on abstractions: inject providers by their interface/token, not concrete construction
- For database requests, do not fetch data that is not needed — `select` only the fields you use

## Mandatory Checks
- [ ] NO business logic in controllers — controllers delegate to injectable services
- [ ] Providers depend on abstractions (injected via DI), never `new`-ed inside a class
- [ ] Duplicated logic is extracted into methods or shared providers
- [ ] Request DTOs carry class-validator decorators and pass through the global `ValidationPipe`
- [ ] Reads always exclude soft-deleted rows with `eq(table.isDeleted, false)`
- [ ] Composable `SQL` condition-builders (query objects) are used for complex filtering
- [ ] Drizzle `select`/relational `with` fetch only needed columns — no N+1 (batch/relation-load instead of per-row queries)
- [ ] Always use curly braces `{ }` for all control blocks (`if`, `else`, `for`, `while`, etc.), even for single statements
- [ ] Before changing a shared signature (table column, DTO, service/interface method), run LSP `findReferences` on it and confirm all call sites are updated

## Folder Conventions
- Query builders → `queries/` folder within the feature
- Jobs → `jobs/` folder within the feature
- DTOs → `dto/` folder within the feature
- Shared utilities → `apps/api/src/common/`

## Async/Await
Always use `async`/`await` for database and I/O operations. Never leave a floating promise
unawaited; batch independent awaits with `Promise.all`.

## Error Handling
Throw Nest HTTP exceptions from the domain: `NotFoundException` when a record is missing (the CRUD
base service already does this in `findOne`), `ForbiddenException` for authorization failures,
`BadRequestException` for invalid input the validator can't express. Let a global exception filter
shape the response.

## Soft deletes

Exclude soft-deleted rows from every read by composing `eq(table.isDeleted, false)` into the `where`.
Prefer a soft delete — set `isDeleted` to `true` — over a hard `db.delete(...)`. Keep audit/soft-delete
fields out of response DTOs.

## Authorization

Every endpoint has an authorization decision, and that decision is visible at the endpoint —
not buried in a service. Three rules:

- **Deny by default.** Configure a fallback policy requiring an authenticated user, so a controller
  that forgets its attribute fails closed. Opening an endpoint is then explicit and greppable.
- **Never compare role strings inline.** `Roles.Admin`, not `"Admin"` — a typo in a string literal
  is a silent authorization bypass that no compiler will catch.
- **Authorize the record, not just the route.** Role checks answer "may this kind of user do this
  kind of thing". They do not answer "may *this* user touch *this* row". Where ownership matters,
  the service must check it after loading the entity.
