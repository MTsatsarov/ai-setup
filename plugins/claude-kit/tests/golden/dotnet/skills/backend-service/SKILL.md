---
name: backend-service
description: Use when writing or changing an ASP.NET Core service — the application layer that holds business logic. Covers the interface/implementation pair, the CRUD base, filtering, transactions across multiple writes, where business rules belong, and how failures are signalled.
---

# Skill: ASP.NET Core Service Layer

## Key Concept
The service is where the application's behaviour lives. Controllers bind and delegate;
entities hold state and invariants; the service decides *what happens*. Anything that is
neither HTTP concerns nor persistence mechanics belongs here.

Feature folders are self-contained under `src/DemoCRM.Api/Features/<Feature>/`:

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

Shared CRUD plumbing lives in `src/DemoCRM.Api/Common/Services/`. The base is soft-delete-aware,
generic in the entity, its key and the four models a feature exposes, and it applies paging,
filtering and sorting for you.

```csharp
// src/DemoCRM.Api/Common/Services/CrudService.cs
public abstract class CrudService<TEntity, TId, TCreateRequest, TUpdateRequest, TListRequest, TListItem>(
    AppDbContext db, IMapper mapper)
    where TEntity : class, IEntity<TId>, ISoftDelete
    where TId : IEquatable<TId>
    where TUpdateRequest : IHasId<TId>
    where TListRequest : BasePaginatedRequest
{
    protected AppDbContext Db { get; } = db;
    protected IMapper Mapper { get; } = mapper;

    // The DbContext's global query filter already excludes soft-deleted rows.
    protected IQueryable<TEntity> Query => Db.Set<TEntity>().AsNoTracking();

    /// Untracked, narrowed to one row — the starting point for a details read.
    protected IQueryable<TEntity> QueryById(TId id) => Query.Where(ById(id));

    protected virtual IEnumerable<string> Filterable => [];
    protected virtual IEnumerable<string> Sortable => [];

    protected virtual IQueryable<TEntity> ApplyCustomFilters(IQueryable<TEntity> source, TListRequest request) =>
        source;

    public async Task<PagedResult<TListItem>> GetListingAsync(TListRequest request, CancellationToken ct = default)
    {
        var source = ApplyCustomFilters(Query, request).ApplyFilters(request.Filters, FilterableFields);

        // Count before paging, after filtering.
        var total = await source.CountAsync(ct);

        var items = await source
            .ApplySorting(request.Sorters, SortableFields)
            .Skip(request.Skip)
            .Take(request.PageSize)
            .ProjectTo<TListItem>(Mapper.ConfigurationProvider)
            .ToListAsync(ct);

        return new PagedResult<TListItem>(items, total, request.Page, request.PageSize);
    }

    public async Task<TId> CreateAsync(TCreateRequest input, CancellationToken ct = default)
    {
        var entity = Mapper.Map<TEntity>(input);
        Db.Set<TEntity>().Add(entity);
        await Db.SaveChangesAsync(ct);
        return entity.Id;
    }

    public async Task<TId> UpdateAsync(TUpdateRequest input, CancellationToken ct = default)
    {
        var entity = await RequireAsync(input.Id, ct);
        Mapper.Map(input, entity);
        await Db.SaveChangesAsync(ct);
        return entity.Id;
    }

    /// Soft delete — sets IsDeleted rather than removing the row.
    public async Task DeleteAsync(TId id, CancellationToken ct = default)
    {
        var entity = await RequireAsync(id, ct);
        entity.IsDeleted = true;
        await Db.SaveChangesAsync(ct);
    }

    protected async Task<TEntity> RequireAsync(TId id, CancellationToken ct = default) =>
        await Db.Set<TEntity>().FirstOrDefaultAsync(ById(id), ct)
        ?? throw new KeyNotFoundException($"Not found: {id}");

    protected static Expression<Func<TEntity, bool>> ById(TId id) => e => e.Id.Equals(id);
}
```

### The four methods

| Method | Takes | Returns |
|---|---|---|
| `GetListingAsync` | `TListRequest` (a `BasePaginatedRequest`) | `PagedResult<TListItem>` |
| `CreateAsync` | `TCreateRequest` | the new `TId` |
| `UpdateAsync` | `TUpdateRequest` (carries the id) | the `TId` |
| `DeleteAsync` | `TId` | nothing — soft delete |

Writes return the **id**, not the entity. An entity is a persistence concern, and handing one back
invites it into a response payload. A caller that needs the saved row reads it back through the
feature's own details method.

There is no `GetAsync` on the base: a details read is the one part of CRUD whose shape is genuinely
per-feature. Start from `QueryById(id)` and project.

### Filtering and sorting

`BasePaginatedRequest` carries `Page`, `PageSize`, `Filters` and `Sorters`. The base applies all
three, but **only over fields the service allowlists**:

```csharp
protected override IEnumerable<string> Filterable => ["Name", "Status", "OwnerId"];
protected override IEnumerable<string> Sortable   => ["Name", "CreatedAt"];
```

Both are empty by default, so a new listing exposes no query surface until it says so — adding a
column to an entity never silently adds a filter to its API. A field outside the allowlist throws
`InvalidOperationException`, which the middleware maps to 400.

Sorting is always a **total order**: your sorters, then `CreatedAt` descending if you supplied none,
then `Id`. That last clause is not decoration — without it two rows with equal sort keys can swap
between requests, and the client sees one row twice while never seeing another.

For anything the descriptors cannot express — a join, a computed predicate, tenant scoping —
override `ApplyCustomFilters`. It composes with the descriptors rather than replacing them:

```csharp
protected override IQueryable<Customer> ApplyCustomFilters(IQueryable<Customer> source, CustomerQuery request) =>
    request.MineOnly == true ? source.Where(c => c.OwnerId == currentUser.Id) : source;
```

`Contains` and `StartsWith` lower both sides, so matching is case-insensitive — which also means a
plain B-tree index will not serve them. A hot search column wants a functional index on
`lower(column)`, or a `EF.Functions.ILike` clause written in `ApplyCustomFilters`.

Note `Query` is `AsNoTracking` — reads never need the change tracker. `RequireAsync` deliberately
re-fetches **tracked** through `Db.Set<TEntity>()` so `SaveChangesAsync` sees the modification.

## Rules

- Every service has an **interface**; controllers depend on the interface, never the class
- CRUD services derive from `CrudService<...>`, declare their query allowlists, and add the
  details read — the four CRUD methods come from the base
- Extra filters go in `ApplyCustomFilters` as composable `IQueryable` clauses — never SQL strings
- Every method takes a `CancellationToken` and passes it down
- Return DTOs, never entities, from read methods

```csharp
// src/DemoCRM.Api/Features/EntityNames/EntityNameService.cs
public interface IEntityNameService
{
    Task<PagedResult<EntityNameListItem>> GetListingAsync(EntityNameQuery request, CancellationToken ct = default);
    Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default);
    Task<Guid> CreateAsync(CreateEntityNameRequest input, CancellationToken ct = default);
    Task<Guid> UpdateAsync(UpdateEntityNameRequest input, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}

public class EntityNameService(AppDbContext db, IMapper mapper)
    : CrudService<EntityName, Guid, CreateEntityNameRequest, UpdateEntityNameRequest, EntityNameQuery, EntityNameListItem>(db, mapper),
      IEntityNameService
{
    // The listing's entire query surface. Nothing outside these is filterable or
    // sortable, however tempting the column.
    protected override IEnumerable<string> Filterable => ["Name", "RelatedEntityId", "CreatedAt"];
    protected override IEnumerable<string> Sortable => ["Name", "CreatedAt"];

    public async Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default) =>
        await QueryById(id).ProjectTo<EntityNameDetails>(Mapper.ConfigurationProvider).FirstOrDefaultAsync(ct)
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
