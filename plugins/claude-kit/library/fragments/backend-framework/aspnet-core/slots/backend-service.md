---
name: backend-controller
description: Use when creating or modifying an ASP.NET Core feature — controller, scoped service, and DI registration. Covers the controller/service/interface triad, a reusable CRUD base, attribute routing, and Swagger grouping.
---

# Skill: ASP.NET Core Feature Pattern

## Key Concept
A feature is three files plus a registration: a `ControllerBase` with attribute routing, an
**interface** describing the service, and the service implementing it. Controllers are thin —
they bind, delegate, and shape the HTTP response. Everything else lives in the service.

Feature folders are self-contained under `<% backend.src_dir %>/Features/<Feature>/`:

```
Features/EntityNames/
  EntityNamesController.cs
  EntityNameService.cs          // interface + implementation
  EntityName.cs                 // the entity
  EntityNameProfile.cs          // mapping
  Models/EntityNameModels.cs    // requests + responses
```

### URL Convention
- `[Route("entity-names")]` → `/entity-names`
- `[HttpGet]` list, `[HttpGet("{id:guid}")]` details, `[HttpPost]` create, `[HttpPut("{id:guid}")]` update, `[HttpDelete("{id:guid}")]`
- Constrain route params (`{id:guid}`) so a malformed id 404s at routing rather than throwing in the service

<% sections.provider %>

<% sections.crud_base %>

## Service

- Every service has an **interface**; controllers depend on the interface, never the class
- CRUD services derive from `CrudService<TEntity>` and expose feature-typed methods over it
- Build filters as composable `IQueryable` clauses guarded by `if` — never build SQL strings
- Every method takes a `CancellationToken` and passes it down
- Return DTOs, never entities, from read methods

```csharp
// <% backend.src_dir %>/Features/EntityNames/EntityNameService.cs
public interface IEntityNameService
{
    Task<PagedResult<EntityNameListItem>> ListAsync(EntityNameQuery query, CancellationToken ct = default);
    Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default);
    Task<EntityName> CreateAsync(CreateEntityNameRequest input, CancellationToken ct = default);
    Task<EntityName> UpdateAsync(Guid id, UpdateEntityNameRequest input, CancellationToken ct = default);
    Task RemoveAsync(Guid id, CancellationToken ct = default);
}

public class EntityNameService(AppDbContext db, IMapper mapper)
    : CrudService<EntityName>(db, mapper), IEntityNameService
{
    public Task<PagedResult<EntityNameListItem>> ListAsync(EntityNameQuery query, CancellationToken ct = default)
    {
        var filtered = Query;

        if (!string.IsNullOrWhiteSpace(query.Name))
        {
            filtered = filtered.Where(e => EF.Functions.ILike(e.Name, $"%{query.Name}%"));
        }

        if (query.RelatedEntityId is { } relatedId)
        {
            filtered = filtered.Where(e => e.RelatedEntityId == relatedId);
        }

        return ListAsync<EntityNameListItem>(query, filtered, ct);
    }

    public Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default) =>
        GetAsync<EntityNameDetails>(id, ct);

    public Task<EntityName> CreateAsync(CreateEntityNameRequest input, CancellationToken ct = default) =>
        CreateAsync<CreateEntityNameRequest>(input, ct);

    public Task<EntityName> UpdateAsync(Guid id, UpdateEntityNameRequest input, CancellationToken ct = default) =>
        UpdateAsync<UpdateEntityNameRequest>(id, input, ct);
}
```

## Controller

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

`[ApiController]` makes model validation automatic — an invalid `[FromBody]` returns 400 with a
`ValidationProblemDetails` before your action runs. Do not hand-write `if (!ModelState.IsValid)`.

## Registration

```csharp
// Program.cs
builder.Services.AddScoped<IEntityNameService, EntityNameService>();
```

Services are **scoped** — they hold a `DbContext`, which is itself scoped. Registering one as a
singleton captures a disposed context and fails at the second request.

## Checklist
- [ ] Feature lives under `<% backend.src_dir %>/Features/<Feature>/` with controller, service + interface, entity, profile, `Models/`
- [ ] Controller is `[ApiController]` with attribute routing and `{id:guid}` constraints
- [ ] Service registered `AddScoped<IFoo, Foo>()` in `Program.cs`
- [ ] Controller depends on the **interface**, not the concrete service
- [ ] Every async method takes and forwards a `CancellationToken`
- [ ] Reads return DTOs projected with `ProjectTo`, never raw entities
- [ ] Deletes are soft (`RemoveAsync` sets `IsDeleted`), never `Remove(entity)`
