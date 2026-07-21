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
<% each orm.quality_checks %>- [ ] <% . %>
<% end %>- [ ] Always use curly braces `{ }` for all control blocks (`if`, `else`, `for`, `while`, etc.), even for single statements
- [ ] Before changing a shared signature (table column, DTO, service/interface method), run LSP `findReferences` on it and confirm all call sites are updated

## Folder Conventions
- Query builders → `queries/` folder within the feature
- Jobs → `jobs/` folder within the feature
- DTOs → `dto/` folder within the feature
- Shared utilities → `<% backend.common_dir %>/`

## Async/Await
Always use `async`/`await` for database and I/O operations. Never leave a floating promise
unawaited; batch independent awaits with `Promise.all`.

## Error Handling
Throw Nest HTTP exceptions from the domain: `NotFoundException` when a record is missing (the CRUD
base service already does this in `findOne`), `ForbiddenException` for authorization failures,
`BadRequestException` for invalid input the validator can't express. Let a global exception filter
shape the response.
