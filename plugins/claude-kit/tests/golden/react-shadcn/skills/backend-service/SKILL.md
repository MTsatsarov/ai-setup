---
name: backend-service
description: Use when writing or changing an ASP.NET Core service — the application layer that holds business logic. Covers the interface/implementation pair, the CRUD base, filtering, transactions across multiple writes, where business rules belong, and how failures are signalled.
---

# Skill: ASP.NET Core Service Layer

## Key Concept
The service is where the application's behaviour lives. Controllers bind and delegate;
entities hold state and invariants; the service decides *what happens*. Anything that is
neither HTTP concerns nor persistence mechanics belongs here.

Feature folders are self-contained under `src/ReactShadcn.Api/Features/<Feature>/`:

```
Features/EntityNames/
  EntityNamesController.cs
  EntityNameService.cs          // interface + implementation
  EntityName.cs                 // the entity
  EntityNameProfile.cs          // mapping
  Models/EntityNameModels.cs    // requests + responses
```

## The DbContext

`AppDbContext` is registered once and injected into every service. It applies configurations from
the assembly and installs the global soft-delete filter:

```csharp
// Program.cs
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

It is **scoped** — one instance per request. Any service holding it must also be scoped.

## Reusable CRUD base

Put shared CRUD plumbing in `src/ReactShadcn.Api/Common/Services/`. The base is soft-delete-aware and
projects reads straight to the DTO, so only the selected columns leave the database.

```csharp
// src/ReactShadcn.Api/Common/Services/CrudService.cs
public abstract class CrudService<TEntity>(AppDbContext db, IMapper mapper)
    where TEntity : AuditedEntity
{
    protected AppDbContext Db { get; } = db;
    protected IMapper Mapper { get; } = mapper;

    // The DbContext's global query filter already excludes soft-deleted rows.
    protected IQueryable<TEntity> Query => Db.Set<TEntity>().AsNoTracking();

    public async Task<PagedResult<TDto>> ListAsync<TDto>(
        PaginationQuery query,
        IQueryable<TEntity>? filtered = null,
        CancellationToken ct = default)
    {
        var source = filtered ?? Query;
        var total = await source.CountAsync(ct);
        var items = await source
            .Skip(query.Skip)
            .Take(query.Take)
            .ProjectTo<TDto>(Mapper.ConfigurationProvider)
            .ToListAsync(ct);

        return new PagedResult<TDto>(items, total);
    }

    public async Task<TDto> GetAsync<TDto>(Guid id, CancellationToken ct = default)
    {
        var dto = await Query
            .Where(e => e.Id == id)
            .ProjectTo<TDto>(Mapper.ConfigurationProvider)
            .FirstOrDefaultAsync(ct);

        return dto ?? throw new KeyNotFoundException($"Not found: {id}");
    }

    public async Task<TEntity> CreateAsync<TInput>(TInput input, CancellationToken ct = default)
    {
        var entity = Mapper.Map<TEntity>(input);
        Db.Set<TEntity>().Add(entity);
        await Db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task<TEntity> UpdateAsync<TInput>(Guid id, TInput input, CancellationToken ct = default)
    {
        var entity = await Db.Set<TEntity>().FirstOrDefaultAsync(e => e.Id == id, ct)
            ?? throw new KeyNotFoundException($"Not found: {id}");

        Mapper.Map(input, entity);
        await Db.SaveChangesAsync(ct);
        return entity;
    }

    /// Soft delete — sets IsDeleted rather than removing the row.
    public async Task RemoveAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await Db.Set<TEntity>().FirstOrDefaultAsync(e => e.Id == id, ct)
            ?? throw new KeyNotFoundException($"Not found: {id}");

        entity.IsDeleted = true;
        await Db.SaveChangesAsync(ct);
    }
}
```

Note `Query` is `AsNoTracking` — reads never need the change tracker. Writes deliberately re-fetch
**tracked** via `Db.Set<TEntity>()` so `SaveChangesAsync` sees the modification.

## Rules

- Every service has an **interface**; controllers depend on the interface, never the class
- CRUD services derive from `CrudService<TEntity>` and expose feature-typed methods over it
- Build filters as composable `IQueryable` clauses guarded by `if` — never build SQL strings
- Every method takes a `CancellationToken` and passes it down
- Return DTOs, never entities, from read methods

```csharp
// src/ReactShadcn.Api/Features/EntityNames/EntityNameService.cs
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

That example is pure passthrough because the feature has no rules yet. Most features do.
The sections below are what to do when they arrive.

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
it returns are not tracked and mutating them saves nothing. **Read through `Db.Set<T>()` when
you intend to write, and `Query` when you only intend to read.** Silently saving nothing is
the most common bug in this layer.

An explicit transaction is only needed when one unit of work spans several
`SaveChangesAsync` calls — typically because you call another service that saves internally:

```csharp
public async Task<EntityName> CreateWithAuditAsync(CreateEntityNameRequest input, CancellationToken ct = default)
{
    await using var tx = await Db.Database.BeginTransactionAsync(ct);

    var created = await CreateAsync(input, ct);          // saves
    await auditService.RecordAsync(created.Id, ct);      // saves again

    await tx.CommitAsync(ct);
    return created;
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
- [ ] Every async method takes and forwards a `CancellationToken`
- [ ] Reads use `Query` (`AsNoTracking`); writes read through `Db.Set<T>()`
- [ ] One `SaveChangesAsync` per unit of work — explicit transaction only across several
- [ ] Reads return DTOs projected with `ProjectTo`, never raw entities
- [ ] Deletes are soft (`RemoveAsync` sets `IsDeleted`), never `Remove(entity)`
- [ ] Failures throw the exception the middleware maps, with the offending value in the message
