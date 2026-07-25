<% if mapping.crud_usings %><% mapping.crud_usings %>
<% end %>using System.Linq.Expressions;
using <% project.pascal %>.Api.Common.Data;
using <% project.pascal %>.Api.Common.Entities;
using <% project.pascal %>.Api.Common.Models;
using Microsoft.EntityFrameworkCore;

namespace <% project.pascal %>.Api.Common.Services;

/// Soft-delete-aware CRUD over an audited entity, generic in the entity, its key,
/// and the four models a feature exposes over it.
///
/// The write methods return the id rather than the entity: an entity is a
/// persistence concern and returning one invites it into a response. Callers that
/// need the saved row read it back through the feature's own details method.
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
    private HashSet<string>? filterableFields;
    private HashSet<string>? sortableFields;

    // The DbContext's global query filter already excludes soft-deleted rows.
    protected IQueryable<TEntity> Query => Db.Set<TEntity>().AsNoTracking();

    /// Untracked, narrowed to one row — the starting point for a details read.
    protected IQueryable<TEntity> QueryById(TId id) => Query.Where(ById(id));

    /// Fields a client may filter on. Empty by default: a listing exposes no query
    /// surface until the feature opts in, so adding a column never silently adds a
    /// filter. Matching is case-insensitive.
    protected virtual IEnumerable<string> Filterable => [];

    protected virtual IEnumerable<string> Sortable => [];

    /// Typed filters the descriptor model cannot express — joins, computed
    /// predicates, tenant scoping. Composes with the descriptors, does not replace
    /// them: both are applied, this one first.
    protected virtual IQueryable<TEntity> ApplyCustomFilters(IQueryable<TEntity> source, TListRequest request) =>
        source;

<% if mapping.crud_abstract_hooks %><% mapping.crud_abstract_hooks %>

<% end %>    public async Task<PagedResult<TListItem>> GetListingAsync(
        TListRequest request,
        CancellationToken ct = default)
    {
        var source = ApplyCustomFilters(Query, request)
            .ApplyFilters(request.Filters, FilterableFields);

        // Count before paging, after filtering — Total is the size of the result
        // set, not of the page.
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

    /// The id travels on the model, so a caller cannot update one row while
    /// claiming to update another. Controllers check it against the route.
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

    /// Tracked read for the write path. Deliberately not `Query`, which is
    /// AsNoTracking — mutating an untracked entity saves nothing.
    protected async Task<TEntity> RequireAsync(TId id, CancellationToken ct = default) =>
        await Db.Set<TEntity>().FirstOrDefaultAsync(ById(id), ct)
        ?? throw new KeyNotFoundException($"Not found: {id}");

    /// A closure rather than a built constant, so EF Core parameterises the id and
    /// the query plan is reused across calls.
    protected static Expression<Func<TEntity, bool>> ById(TId id) => e => e.Id.Equals(id);

    private HashSet<string> FilterableFields =>
        filterableFields ??= new HashSet<string>(Filterable, StringComparer.OrdinalIgnoreCase);

    private HashSet<string> SortableFields =>
        sortableFields ??= new HashSet<string>(Sortable, StringComparer.OrdinalIgnoreCase);
}
