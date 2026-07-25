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
`src/DemoCRM.Api/Features/<Feature>/<Feature>Controller.cs`.

## URL Convention
- `[Route("entity-names")]` → `/entity-names` — plural, kebab-case, no `api/` prefix
- `[HttpGet]` list, `[HttpGet("{id:guid}")]` details, `[HttpPost]` create,
  `[HttpPut("{id:guid}")]` update, `[HttpDelete("{id:guid}")]` remove
- Constrain route params (`{id:guid}`) so a malformed id 404s at routing rather than
  throwing inside the service

## The pattern

```csharp
// src/DemoCRM.Api/Features/EntityNames/EntityNamesController.cs
[ApiController]
[Route("entity-names")]
[Produces("application/json")]
public class EntityNamesController(IEntityNameService service) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<EntityNameListItem>> List([FromQuery] EntityNameQuery request, CancellationToken ct) =>
        service.GetListingAsync(request, ct);

    [HttpGet("{id:guid}")]
    public Task<EntityNameDetails> Get(Guid id, CancellationToken ct) =>
        service.GetAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<EntityNameDetails>> Create([FromBody] CreateEntityNameRequest input, CancellationToken ct)
    {
        var id = await service.CreateAsync(input, ct);
        return CreatedAtAction(nameof(Get), new { id }, await service.GetAsync(id, ct));
    }

    [HttpPut("{id:guid}")]
    public async Task<EntityNameDetails> Update(Guid id, [FromBody] UpdateEntityNameRequest input, CancellationToken ct)
    {
        // The id is in both the route and the body. They must agree, or the request
        // is claiming to update one row while naming another.
        if (id != input.Id)
        {
            throw new InvalidOperationException($"Route id {id} does not match body id {input.Id}.");
        }

        await service.UpdateAsync(input, ct);
        return await service.GetAsync(id, ct);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(id, ct);
        return NoContent();
    }
}
```

## Binding a paginated request

`EntityNameQuery` extends `BasePaginatedRequest`, so `[FromQuery]` binds `Page` and `PageSize`
directly and the descriptor lists by index:

```
GET /entity-names
  ?Page=2&PageSize=20
  &Filters[0].Field=Name&Filters[0].Operator=Contains&Filters[0].Value=acme
  &Filters[1].Field=Status&Filters[1].Operator=Equals&Filters[1].Value=Active
  &Sorters[0].Field=CreatedAt&Sorters[0].Descending=true
```

The indexed form is the model binder's convention for a collection of complex types, and it is
not guessable — document it in the endpoint's Swagger summary for anyone writing a client by hand.

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
| Delete | 204 | `NoContent()` — no body |

A filter naming a field the service did not allowlist throws `InvalidOperationException` and
becomes a 400, in the middleware — the controller does not check it.

## Checklist
- [ ] `[ApiController]` with attribute routing and `{id:guid}` constraints
- [ ] Constructor takes the service **interface**
- [ ] Every action takes and forwards a `CancellationToken`
- [ ] No business logic, no `try`/`catch`, no `ModelState` check
- [ ] `Update` rejects a route id that disagrees with the body id
- [ ] `Create` returns `CreatedAtAction`; `Delete` returns `NoContent`
- [ ] Route is plural kebab-case
