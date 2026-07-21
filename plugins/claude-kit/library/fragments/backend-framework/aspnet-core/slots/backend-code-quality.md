---
name: backend-code-quality
description: Use as a checklist after implementing backend code. Covers SOLID, async/await rules, DI lifetimes, IQueryable hygiene, validation, and error handling in ASP.NET Core.
---

# Skill: Backend Code Quality Rules

## SOLID & Clean Code
- Follow SOLID principles
- Extract duplicated logic into private methods or shared services
- Depend on abstractions: inject interfaces through the constructor, never `new` a dependency
- Do not fetch data you will not use — project to the DTO rather than loading the entity

## Mandatory Checks
- [ ] NO business logic in controllers — controllers delegate to a scoped service
- [ ] Every service has an interface, and the controller depends on the interface
- [ ] Services are registered `AddScoped` — never singleton, they hold a `DbContext`
- [ ] Request models carry DataAnnotations; `[ApiController]` handles the 400 automatically
- [ ] Every async method takes a `CancellationToken` and forwards it to EF Core
<% each orm.quality_checks %>- [ ] <% . %>
<% end %>- [ ] Always use curly braces `{ }` for all control blocks (`if`, `else`, `for`, `while`), even for single statements
- [ ] Before changing a shared signature (entity property, DTO, service method), run LSP `findReferences` and confirm every call site is updated

## Async/Await
Every I/O path is `async` all the way down. Never call `.Result` or `.Wait()` — on a request thread
that is a deadlock waiting to happen. Use the EF Core async operators (`ToListAsync`,
`FirstOrDefaultAsync`, `CountAsync`); the synchronous ones block a thread-pool thread per call.

Return the `Task` directly when the method adds nothing after the await:

```csharp
// good — no state machine allocated
public Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default) =>
    GetAsync<EntityNameDetails>(id, ct);
```

Use `async`/`await` when you genuinely need the result, or when a `using` must outlive the call.

## Folder Conventions
- Feature code → `<% backend.src_dir %>/Features/<Feature>/`
- Requests/responses → that feature's `Models/`
- EF configurations → `<% backend.src_dir %>/Data/Configurations/`
- Shared base types → `<% backend.common_dir %>/`

## Error Handling
Throw from the domain and let a global handler translate:

| Situation | Throw |
|---|---|
| Record missing | `KeyNotFoundException` → 404 |
| Caller may not do this | `UnauthorizedAccessException` → 403 |
| Invalid input the validator cannot express | `ArgumentException` → 400 |

Register one `IExceptionHandler` (or `UseExceptionHandler`) that maps these to
`ProblemDetails`. Do not return `NotFound()` from a service — services do not know about HTTP.
