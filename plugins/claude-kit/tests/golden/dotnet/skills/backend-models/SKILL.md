---
name: backend-models
description: Use when creating or modifying request/response models for an ASP.NET Core feature. Covers DataAnnotations validation, the PaginationQuery base, records for responses, and separate listing vs details shapes.
---

# Skill: Request / Response Models

## Overview
Models live in `src/DemoCRM.Api/Features/<Feature>/Models/`. Requests are **classes** with
DataAnnotations, validated automatically by `[ApiController]`. Responses are **records** — they are
immutable, value-compared, and project cleanly from a query.

## Roles
- **Create/Update requests** — validated input. Decorate every field; never accept an entity.
  The update request implements `IHasId<TId>`, because the CRUD base reads the id off the model.
- **Response records** — the public shape. Two of them: a light listing shape and a full details shape.
- **Query** — extends `BasePaginatedRequest`, adding only what the generic filters cannot express.

## Templates

```csharp
// src/DemoCRM.Api/Features/EntityNames/Models/EntityNameModels.cs
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
// src/DemoCRM.Api/Common/Models/Pagination.cs
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

## Mapping with AutoMapper

One `Profile` per feature, beside the service. Registered once by assembly scan:

```csharp
// Program.cs
builder.Services.AddAutoMapper(cfg => cfg.AddMaps(typeof(Program).Assembly));
```

```csharp
// src/DemoCRM.Api/Features/EntityNames/EntityNameProfile.cs
public class EntityNameProfile : Profile
{
    public EntityNameProfile()
    {
        // Entity -> DTO. Flattening conventions resolve RelatedEntity.Name to
        // RelatedEntityName, but naming it explicitly keeps ProjectTo honest
        // when the shape later drifts.
        CreateMap<EntityName, EntityNameListItem>()
            .ForCtorParam(nameof(EntityNameListItem.RelatedEntityName),
                o => o.MapFrom(e => e.RelatedEntity!.Name));

        CreateMap<EntityName, EntityNameDetails>()
            .ForCtorParam(nameof(EntityNameDetails.RelatedEntityName),
                o => o.MapFrom(e => e.RelatedEntity!.Name));

        // DTO -> entity. Audit/soft-delete fields are never client-settable.
        CreateMap<CreateEntityNameRequest, EntityName>()
            .ForMember(e => e.Id, o => o.Ignore())
            .ForMember(e => e.CreatedAt, o => o.Ignore())
            .ForMember(e => e.UpdatedAt, o => o.Ignore())
            .ForMember(e => e.IsDeleted, o => o.Ignore())
            .ForMember(e => e.RelatedEntity, o => o.Ignore());
    }
}
```

### ProjectTo is the point

```csharp
// Good — the projection becomes SQL; only the DTO's columns are selected.
await Query.ProjectTo<EntityNameListItem>(Mapper.ConfigurationProvider).ToListAsync(ct);

// Bad — loads every column of every row, then discards most of them in memory.
var entities = await Query.ToListAsync(ct);
return Mapper.Map<List<EntityNameListItem>>(entities);
```

`ProjectTo` also resolves navigation properties without an explicit `Include`, because the
projection tells EF Core exactly which joins it needs.

### Rules
- **Never map DTO → entity for updates blindly.** `Ignore()` every server-owned field, or a client
  can set `Id`/`IsDeleted` by posting them.
- Only mapping expressions EF Core can translate work in `ProjectTo` — a custom `ResolveUsing`
  with C# logic will not, and fails at runtime rather than compile time.
- Add `AssertConfigurationIsValid()` in a test. An unmapped constructor parameter otherwise
  surfaces as a null field in production.
