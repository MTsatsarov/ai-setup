## Reusable CRUD base

Put shared CRUD plumbing in `<% backend.common_dir %>/Services/`. The base is soft-delete-aware and
projects reads straight to the DTO, so only the selected columns leave the database.

```csharp
// <% backend.common_dir %>/Services/CrudService.cs
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
