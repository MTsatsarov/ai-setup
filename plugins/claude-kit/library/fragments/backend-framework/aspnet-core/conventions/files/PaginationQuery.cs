using System.ComponentModel.DataAnnotations;

namespace <% project.pascal %>.Api.Common.Models;

/// Shared base every list query extends.
public class PaginationQuery
{
    [Range(0, int.MaxValue)]
    public int Skip { get; set; }

    [Range(1, 100)]
    public int Take { get; set; } = 20;
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total);
