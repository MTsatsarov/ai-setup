---
name: backend-controller
description: Use when creating or modifying an ASP.NET Core controller — attribute routing, URL conventions, action signatures, status codes and DI. Covers what belongs in the HTTP layer and what must be delegated to a service.
---

# Skill: ASP.NET Core Controller

## Key Concept
Controllers are **thin**. An action binds the request, calls one service method, and shapes the
HTTP response. That is the whole job. If an action contains an `if` that is not about HTTP, the
logic belongs in the service.

A controller lives beside the service it calls, under
`<% backend.src_dir %>/Features/<Feature>/<Feature>Controller.cs`.

## URL Convention
- `[Route("entity-names")]` → `/entity-names` — plural, kebab-case, no `api/` prefix
- `[HttpGet]` list, `[HttpGet("{id:guid}")]` details, `[HttpPost]` create,
  `[HttpPut("{id:guid}")]` update, `[HttpDelete("{id:guid}")]` remove
- Constrain route params (`{id:guid}`) so a malformed id 404s at routing rather than
  throwing inside the service

## The pattern

```csharp
// <% backend.src_dir %>/Features/EntityNames/EntityNamesController.cs
[ApiController]
[Route("entity-names")]
[Produces("application/json")]
public class EntityNamesController(IEntityNameService service) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<EntityNameListItem>> List([FromQuery] EntityNameQuery query, CancellationToken ct) =>
        service.ListAsync(query, ct);

    [HttpGet("{id:guid}")]
    public Task<EntityNameDetails> Get(Guid id, CancellationToken ct) =>
        service.GetAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<EntityNameDetails>> Create([FromBody] CreateEntityNameRequest input, CancellationToken ct)
    {
        var created = await service.CreateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, await service.GetAsync(created.Id, ct));
    }

    [HttpPut("{id:guid}")]
    public async Task<EntityNameDetails> Update(Guid id, [FromBody] UpdateEntityNameRequest input, CancellationToken ct)
    {
        await service.UpdateAsync(id, input, ct);
        return await service.GetAsync(id, ct);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
    {
        await service.RemoveAsync(id, ct);
        return NoContent();
    }
}
```

## Rules

**Depend on the interface.** The constructor takes `IEntityNameService`, never the concrete
class — that is what keeps the controller testable and the layering honest.

**Do not hand-write validation.** `[ApiController]` makes model validation automatic: an
invalid `[FromBody]` returns 400 with a `ValidationProblemDetails` before your action runs.
Writing `if (!ModelState.IsValid)` is dead code.

**Do not catch exceptions to set status codes.** A service throwing `KeyNotFoundException`
becomes a 404 in the exception-handling middleware, in one place. A `try`/`catch` in an action
is the same mapping written again, inconsistently.

**Return the type, not `IActionResult`, when there is one shape.** `Task<EntityNameDetails>`
documents itself in Swagger. Reach for `ActionResult<T>` only when an action genuinely returns
more than one shape — `Create` does, because `CreatedAtAction` carries a `Location` header.

**Let `CancellationToken` flow.** Take it as a parameter and pass it on; ASP.NET Core binds it
to the request-aborted token, so a client that disconnects stops the database work too.

## Status codes

| Action | Success | Notes |
|---|---|---|
| List / Get | 200 | Get 404s via the service's `KeyNotFoundException` |
| Create | 201 | `CreatedAtAction` sets `Location` to the new resource |
| Update | 200 | Return the updated representation |
| Remove | 204 | `NoContent()` — no body |

## Checklist
- [ ] `[ApiController]` with attribute routing and `{id:guid}` constraints
- [ ] Constructor takes the service **interface**
- [ ] Every action takes and forwards a `CancellationToken`
- [ ] No business logic, no `try`/`catch`, no `ModelState` check
- [ ] `Create` returns `CreatedAtAction`; `Remove` returns `NoContent`
- [ ] Route is plural kebab-case
