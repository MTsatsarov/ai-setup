---
name: backend-permissions
description: Use when adding a feature that requires authorization. Covers role constants, deny-by-default configuration, where to enforce role checks versus ownership checks, and the bypasses to avoid.
---

# Skill: Role-Based Authorization

## Key Concept
Roles answer **"may this kind of user do this kind of thing"**. They do not answer
**"may this user touch this row"**. The first is declarative and belongs at the endpoint; the
second is a domain rule and belongs in the service, after the entity is loaded.

Conflating them is the most common authorization bug: an endpoint correctly restricted to
`Manager` that still lets any manager edit any other team's records.

## Role constants

One file, referenced everywhere. Never type a role as a string literal at a call site — a typo in
`"Amin"` compiles, deploys, and silently denies (or worse, a typo in a *negative* check silently allows).

```csharp
// src/DemoCRM.Api/Common/Authorization/Roles.cs
public static class Roles
{
    public const string Admin = "Admin";
    public const string Manager = "Manager";
    public const string User = "User";
}
```

### Enforcing in ASP.NET Core

Apply `[Authorize]` at the controller and narrow per action. An action with no attribute inherits
the controller's policy, so put the restrictive default on the class:

```csharp
[ApiController]
[Route("entity-names")]
[Authorize(Roles = Roles.User)]
public class EntityNamesController(IEntityNameService service) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<EntityNameListItem>> List([FromQuery] EntityNameQuery request, CancellationToken ct) =>
        service.GetListingAsync(request, ct);

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = Roles.Admin)]   // narrower than the controller default
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(id, ct);
        return NoContent();
    }
}
```

Register the fallback so a controller that forgets `[Authorize]` is still closed:

```csharp
// Program.cs
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
```

Endpoints that must stay open are then explicit with `[AllowAnonymous]` — a deny-by-default
posture, so a missing attribute fails closed rather than open.

## Ownership checks belong in the service

```csharp
public async Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default)
{
    var entity = await Query.FirstOrDefaultAsync(e => e.Id == id, ct)
        ?? throw new KeyNotFoundException($"Not found: {id}");

    // Role said "managers may read entities". This says "and only their own".
    if (!currentUser.IsInRole(Roles.Admin) && entity.OwnerId != currentUser.Id)
    {
        throw new UnauthorizedAccessException();
    }

    return Mapper.Map<EntityNameDetails>(entity);
}
```

Note it throws **after** loading. Returning 404 rather than 403 for a record the caller may not see
is a deliberate choice — 403 confirms the record exists, which is itself a leak. Pick one policy and
apply it consistently.

## Checklist
- [ ] Every new endpoint has an explicit authorization decision — inherited, narrowed, or `[AllowAnonymous]`
- [ ] A fallback policy requires an authenticated user, so a forgotten attribute fails closed
- [ ] Roles are referenced via `Roles.*` constants, never string literals
- [ ] Where ownership matters, the service checks it after loading the entity
- [ ] List endpoints filter by ownership in the query — do not load everything and filter in memory
- [ ] The 404-vs-403 policy for unauthorized records is consistent across the codebase
