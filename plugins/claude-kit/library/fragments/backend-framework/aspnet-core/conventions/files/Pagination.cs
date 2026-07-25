using System.ComponentModel.DataAnnotations;

namespace <% project.pascal %>.Api.Common.Models;

/// Implemented by update requests so the CRUD base can read the id off the model.
public interface IHasId<TId>
{
    TId Id { get; set; }
}

public enum FilterOperator
{
    Equals,
    NotEquals,
    Contains,
    StartsWith,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    In,
    IsNull,
    IsNotNull,
}

/// One client-supplied filter. `Field` must appear in the service's Filterable
/// allowlist or the request is rejected — this type is not a query language.
public class FilterDescriptor
{
    [Required]
    public string Field { get; set; } = string.Empty;

    public FilterOperator Operator { get; set; } = FilterOperator.Equals;

    /// Parsed into the target property's type. For `In`, a comma-separated list.
    /// Ignored by `IsNull` / `IsNotNull`.
    public string? Value { get; set; }
}

public class SortDescriptor
{
    [Required]
    public string Field { get; set; } = string.Empty;

    public bool Descending { get; set; }
}

/// Shared base every listing request extends.
public class BasePaginatedRequest
{
    [Range(1, int.MaxValue)]
    public int Page { get; set; } = 1;

    [Range(1, 200)]
    public int PageSize { get; set; } = 20;

    public List<FilterDescriptor> Filters { get; set; } = [];

    public List<SortDescriptor> Sorters { get; set; } = [];

    public int Skip => (Page - 1) * PageSize;
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(Total / (double)PageSize);
}
