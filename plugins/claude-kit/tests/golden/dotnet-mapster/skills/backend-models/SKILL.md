---
name: backend-models
description: Use when creating or modifying request/response models for an ASP.NET Core feature. Covers DataAnnotations validation, the PaginationQuery base, records for responses, and separate listing vs details shapes.
---

# Skill: Request / Response Models

## Overview
Models live in `src/MapsterShop.Api/Features/<Feature>/Models/`. Requests are **classes** with
DataAnnotations, validated automatically by `[ApiController]`. Responses are **records** — they are
immutable, value-compared, and project cleanly from a query.

## Roles
- **Create/Update requests** — validated input. Decorate every field; never accept an entity.
  The update request implements `IHasId<TId>`, because the CRUD base reads the id off the model.
- **Response records** — the public shape. Two of them: a light listing shape and a full details shape.
- **Query** — extends `BasePaginatedRequest`, adding only what the generic filters cannot express.

## Templates

```csharp
// src/MapsterShop.Api/Features/EntityNames/Models/EntityNameModels.cs
public class CreateEntityNameRequest
{
    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public Guid? RelatedEntityId { get; set; }
}

public class UpdateEntityNameRequest : IHasId<Guid>
{
    [Required]
    public Guid Id { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public Guid? RelatedEntityId { get; set; }
}

/// Page, PageSize, Filters and Sorters come from the base. Add a property here only
/// for a filter the descriptors cannot express — one the service reads in
/// ApplyCustomFilters. Ordinary column filters need no property at all.
public class EntityNameQuery : BasePaginatedRequest
{
    public bool? MineOnly { get; set; }
}

/// Listing shape — deliberately lighter than the details shape.
public record EntityNameListItem(Guid Id, string Name, string? RelatedEntityName);

public record EntityNameDetails(
    Guid Id,
    string Name,
    Guid? RelatedEntityId,
    string? RelatedEntityName,
    DateTimeOffset CreatedAt);
```

The shared pagination base:

```csharp
// src/MapsterShop.Api/Common/Models/Pagination.cs
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

public class FilterDescriptor
{
    [Required] public string Field { get; set; } = string.Empty;
    public FilterOperator Operator { get; set; } = FilterOperator.Equals;
    public string? Value { get; set; }     // parsed to the property's type; comma-separated for In
}

public class SortDescriptor
{
    [Required] public string Field { get; set; } = string.Empty;
    public bool Descending { get; set; }
}

public enum FilterOperator
{
    Equals, NotEquals, Contains, StartsWith,
    GreaterThan, GreaterThanOrEqual, LessThan, LessThanOrEqual,
    In, IsNull, IsNotNull,
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(Total / (double)PageSize);
}
```

`Field` is not free-form: it is matched against the service's `Filterable`/`Sortable` allowlist,
and anything else is a 400. See the service skill.

## Rules
- **Two response shapes, always.** A listing that returns 200 rows must not carry the details payload.
- Never expose `IsDeleted`, and expose `UpdatedAt` only where a client genuinely needs it.
- Never accept `CreatedAt`, `UpdatedAt` or `IsDeleted` on a request — they are server-owned.
  `Id` is the one exception, and only on an **update** request, where it identifies the target.
  A create request never carries one.
- Do not reuse a request type as a response type. They diverge, and the day they do you will
  discover it by leaking a field.
- Prefer `record` for responses, `class` for requests: requests are model-bound and mutated by the
  binder, responses are constructed once.

## Mapping with Mapster

Config lives in an `IRegister` per feature, scanned once at startup:

```csharp
// Program.cs
var config = TypeAdapterConfig.GlobalSettings;
config.Scan(typeof(Program).Assembly);
builder.Services.AddSingleton(config);
builder.Services.AddScoped<IMapper, ServiceMapper>();
```

```csharp
// src/MapsterShop.Api/Features/EntityNames/EntityNameMapping.cs
public class EntityNameMapping : IRegister
{
    public void Register(TypeAdapterConfig config)
    {
        config.NewConfig<EntityName, EntityNameListItem>()
            .Map(dest => dest.RelatedEntityName, src => src.RelatedEntity!.Name);

        config.NewConfig<EntityName, EntityNameDetails>()
            .Map(dest => dest.RelatedEntityName, src => src.RelatedEntity!.Name);

        // Audit/soft-delete fields are never client-settable.
        config.NewConfig<CreateEntityNameRequest, EntityName>()
            .Ignore(dest => dest.Id)
            .Ignore(dest => dest.CreatedAt)
            .Ignore(dest => dest.UpdatedAt)
            .Ignore(dest => dest.IsDeleted)
            .Ignore(dest => dest.RelatedEntity!);
    }
}
```

### ProjectToType is the point

```csharp
// Good — becomes SQL; only the DTO's columns are selected.
await Query.ProjectToType<EntityNameListItem>(config).ToListAsync(ct);

// Bad — loads everything, then discards most of it.
var entities = await Query.ToListAsync(ct);
return entities.Adapt<List<EntityNameListItem>>();
```

### Rules
- `Adapt<T>()` on a materialised list is in-memory mapping. `ProjectToType` on an `IQueryable` is
  SQL projection. The names are similar and the performance difference is not.
- **Ignore every server-owned field** on the request → entity direction.
- Mapster maps by convention with no config at all, which is convenient and dangerous: a renamed
  property silently stops mapping. Add `config.Compile()` at startup so mismatches fail fast.
