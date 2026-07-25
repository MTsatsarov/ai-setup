---
name: backend-service
description: Use when writing or changing an ASP.NET Core service — the application layer that holds business logic. Covers the interface/implementation pair, the CRUD base, filtering, transactions across multiple writes, where business rules belong, and how failures are signalled.
---

# Skill: ASP.NET Core Service Layer

## Key Concept
The service is where the application's behaviour lives. Controllers bind and delegate;
entities hold state and invariants; the service decides *what happens*. Anything that is
neither HTTP concerns nor persistence mechanics belongs here.

Feature folders are self-contained under `<% backend.src_dir %>/Features/<Feature>/`:

```
Features/EntityNames/
  EntityNamesController.cs
  EntityNameService.cs          // interface + implementation
  EntityName.cs                 // the entity
  EntityNameProfile.cs          // mapping
  Models/EntityNameModels.cs    // requests + responses
```

<% sections.provider %>

<% sections.crud_base %>

## Rules

- Every service has an **interface**; controllers depend on the interface, never the class
- CRUD services derive from `CrudService<...>`, declare their query allowlists, and add the
  details read — the four CRUD methods come from the base
- Extra filters go in `ApplyCustomFilters` as composable `IQueryable` clauses — never SQL strings
- Every method takes a `CancellationToken` and passes it down
- Return DTOs, never entities, from read methods

```csharp
// <% backend.src_dir %>/Features/EntityNames/EntityNameService.cs
public interface IEntityNameService
{
    Task<PagedResult<EntityNameListItem>> GetListingAsync(EntityNameQuery request, CancellationToken ct = default);
    Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default);
    Task<Guid> CreateAsync(CreateEntityNameRequest input, CancellationToken ct = default);
    Task<Guid> UpdateAsync(UpdateEntityNameRequest input, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}

public class EntityNameService(<% mapping.crud_ctor_params %>)
    : CrudService<EntityName, Guid, CreateEntityNameRequest, UpdateEntityNameRequest, EntityNameQuery, EntityNameListItem>(<% mapping.crud_ctor_args %>),
      IEntityNameService
{
    // The listing's entire query surface. Nothing outside these is filterable or
    // sortable, however tempting the column.
    protected override IEnumerable<string> Filterable => ["Name", "RelatedEntityId", "CreatedAt"];
    protected override IEnumerable<string> Sortable => ["Name", "CreatedAt"];
<% if mapping.crud_derived_hooks %>
<% mapping.crud_derived_hooks %>
<% end %>
    public async Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default) =>
        await <% mapping.crud_details_read %>
        ?? throw new KeyNotFoundException($"Not found: {id}");
}
```

`GetListingAsync`, `CreateAsync`, `UpdateAsync` and `DeleteAsync` are inherited — the interface
re-declares them so callers can depend on it, but there is nothing to write. That leaves the
allowlists and the details read, which is the part that is genuinely per-feature.

The example has no business rules yet. Most features grow them; the sections below are where they go.

## Where business rules go

| Rule | Belongs in |
|---|---|
| "Name is required, max 200 chars" | the request model — DataAnnotations, checked before the service runs |
| "An entity is always created with a valid state" | the entity's constructor or factory |
| "Cannot archive an entity that has open children" | **the service** — it needs to query other data |
| "Only an admin may do this" | the authorization policy, not the service |

The test is whether the rule needs to *look something up*. Shape rules belong to the model,
invariants belong to the entity, and anything requiring a second query belongs to the service.

Never re-validate in the service what `[ApiController]` already rejected — by the time a
service method runs, the request model is valid. Services assume valid input and enforce
only what validation cannot express.

## Writes and transactions

`CrudService` calls `SaveChangesAsync` for you on each of its own operations. That is a
transaction: EF Core wraps a single `SaveChangesAsync` in one, so a create or update is
already atomic on its own.

The rule that matters: **one `SaveChangesAsync` per unit of work, not one per entity.**
Mutate everything, then save once, and EF Core commits it as a single transaction.

```csharp
public async Task ArchiveWithChildrenAsync(Guid id, CancellationToken ct = default)
{
    var entity = await Db.EntityNames
        .Include(e => e.Children)
        .FirstOrDefaultAsync(e => e.Id == id, ct)
        ?? throw new KeyNotFoundException($"Not found: {id}");

    entity.IsDeleted = true;
    foreach (var child in entity.Children)
    {
        child.IsDeleted = true;
    }

    await Db.SaveChangesAsync(ct);   // one call, one transaction
}
```

Note this reads through `Db` directly, not `Query` — `Query` is `AsNoTracking`, so entities
it returns are not tracked and mutating them saves nothing. **Read through `Db.Set<T>()` (or the
base's `RequireAsync`) when you intend to write, and `Query`/`QueryById` when you only intend to
read.** Silently saving nothing is the most common bug in this layer.

An explicit transaction is only needed when one unit of work spans several
`SaveChangesAsync` calls — typically because you call another service that saves internally:

```csharp
public async Task<Guid> CreateWithAuditAsync(CreateEntityNameRequest input, CancellationToken ct = default)
{
    await using var tx = await Db.Database.BeginTransactionAsync(ct);

    var id = await CreateAsync(input, ct);       // saves
    await auditService.RecordAsync(id, ct);      // saves again

    await tx.CommitAsync(ct);
    return id;
}
```

Do not reach for `BeginTransactionAsync` when a single `SaveChangesAsync` would do — it adds
a failure mode and buys nothing.

## Calling other services

Inject the other service's **interface**, exactly as a controller would. Two constraints:

- **No cycles.** If A needs B and B needs A, the shared logic belongs in a third service that
  both depend on. A cycle is a DI failure at startup, not a compile error, so it surfaces late.
- **The caller owns the transaction.** A service method that may be composed into a larger
  unit of work should not assume it is the outermost one.

## Signalling failure

Throw. Do not return `null` to mean "not found" and do not invent a result wrapper for this
codebase — the CRUD base already throws `KeyNotFoundException`, and consistency matters more
than the merits of either style.

| Situation | Throw | Maps to |
|---|---|---|
| Entity does not exist | `KeyNotFoundException` | 404 |
| Caller broke a business rule | `InvalidOperationException` | 400 |
| Caller may not do this | `UnauthorizedAccessException` | 403 |

Include the offending id or value in the message. `$"Cannot archive {id}: {count} children are still open"`
is a bug report; `"Invalid operation"` is a support ticket.

Map these to status codes **once**, in an exception-handling middleware — never with
`try`/`catch` in a controller action.

## Registration

```csharp
// Program.cs
builder.Services.AddScoped<IEntityNameService, EntityNameService>();
```

Services are **scoped** — they hold a `DbContext`, which is itself scoped. Registering one as a
singleton captures a disposed context and fails at the second request.

## Checklist
- [ ] Service has an interface, and callers depend on the interface
- [ ] Registered `AddScoped<IFoo, Foo>()` in `Program.cs`
- [ ] `Filterable` and `Sortable` are overridden — and list only what the API should expose
- [ ] Every async method takes and forwards a `CancellationToken`
- [ ] Reads use `Query`/`QueryById` (`AsNoTracking`); writes go through `RequireAsync`
- [ ] One `SaveChangesAsync` per unit of work — explicit transaction only across several
- [ ] Reads return DTOs projected in the database, never raw entities
- [ ] Deletes are soft (`DeleteAsync` sets `IsDeleted`), never `Remove(entity)`
- [ ] Failures throw the exception the middleware maps, with the offending value in the message
