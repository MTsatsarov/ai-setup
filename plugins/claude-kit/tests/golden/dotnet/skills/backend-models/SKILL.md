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
- **Response records** — the public shape. Two of them: a light listing shape and a full details shape.
- **Query** — extends `PaginationQuery`, carries the feature's filters.

## Templates

```csharp
// src/DemoCRM.Api/Features/EntityNames/Models/EntityNameModels.cs
public class CreateEntityNameRequest
{
    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public Guid? RelatedEntityId { get; set; }
}

public class UpdateEntityNameRequest
{
    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public Guid? RelatedEntityId { get; set; }
}

public class EntityNameQuery : PaginationQuery
{
    public string? Name { get; set; }
    public Guid? RelatedEntityId { get; set; }
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
// src/DemoCRM.Api/Common/Models/PaginationQuery.cs
public class PaginationQuery
{
    [Range(0, int.MaxValue)]
    public int Skip { get; set; }

    [Range(1, 100)]
    public int Take { get; set; } = 20;
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total);
```

## Rules
- **Two response shapes, always.** A listing that returns 200 rows must not carry the details payload.
- Never expose `IsDeleted`, and expose `UpdatedAt` only where a client genuinely needs it.
- Never accept `Id`, `CreatedAt`, `UpdatedAt` or `IsDeleted` on a request — they are server-owned.
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
