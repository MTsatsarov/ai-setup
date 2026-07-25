## Reusable CRUD base

Shared CRUD plumbing lives in `<% backend.common_dir %>/Services/`. The base is soft-delete-aware,
generic in the entity, its key and the four models a feature exposes, and it applies paging,
filtering and sorting for you.

```csharp
// <% backend.common_dir %>/Services/CrudService.cs
public abstract class CrudService<TEntity, TId, TCreateRequest, TUpdateRequest, TListRequest, TListItem>(
    <% mapping.crud_ctor_params %>)
    where TEntity : class, IEntity<TId>, ISoftDelete
    where TId : IEquatable<TId>
    where TUpdateRequest : IHasId<TId>
    where TListRequest : BasePaginatedRequest
{
    protected AppDbContext Db { get; } = db;
<% if mapping.crud_mapper_member %><% mapping.crud_mapper_member %>
<% end %>
    // The DbContext's global query filter already excludes soft-deleted rows.
    protected IQueryable<TEntity> Query => Db.Set<TEntity>().AsNoTracking();

    /// Untracked, narrowed to one row — the starting point for a details read.
    protected IQueryable<TEntity> QueryById(TId id) => Query.Where(ById(id));

    protected virtual IEnumerable<string> Filterable => [];
    protected virtual IEnumerable<string> Sortable => [];

    protected virtual IQueryable<TEntity> ApplyCustomFilters(IQueryable<TEntity> source, TListRequest request) =>
        source;
<% if mapping.crud_abstract_hooks %>
<% mapping.crud_abstract_hooks %>
<% end %>
    public async Task<PagedResult<TListItem>> GetListingAsync(TListRequest request, CancellationToken ct = default)
    {
        var source = ApplyCustomFilters(Query, request).ApplyFilters(request.Filters, FilterableFields);

        // Count before paging, after filtering.
        var total = await source.CountAsync(ct);

        var items = await source
            .ApplySorting(request.Sorters, SortableFields)
            .Skip(request.Skip)
            .Take(request.PageSize)
            <% mapping.crud_listing_projection %>
            .ToListAsync(ct);

        return new PagedResult<TListItem>(items, total, request.Page, request.PageSize);
    }

    public async Task<TId> CreateAsync(TCreateRequest input, CancellationToken ct = default)
    {
        var entity = <% mapping.crud_map_create %>;
        Db.Set<TEntity>().Add(entity);
        await Db.SaveChangesAsync(ct);
        return entity.Id;
    }

    public async Task<TId> UpdateAsync(TUpdateRequest input, CancellationToken ct = default)
    {
        var entity = await RequireAsync(input.Id, ct);
        <% mapping.crud_map_update %>;
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
