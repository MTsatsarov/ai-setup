---
name: backend-models
description: Use when creating or modifying request/response models for an ASP.NET Core feature. Covers DataAnnotations validation, the PaginationQuery base, records for responses, and separate listing vs details shapes.
---

# Skill: Request / Response Models

## Overview
Models live in `<% backend.src_dir %>/Features/<Feature>/Models/`. Requests are **classes** with
DataAnnotations, validated automatically by `[ApiController]`. Responses are **records** — they are
immutable, value-compared, and project cleanly from a query.

## Roles
- **Create/Update requests** — validated input. Decorate every field; never accept an entity.
- **Response records** — the public shape. Two of them: a light listing shape and a full details shape.
- **Query** — extends `PaginationQuery`, carries the feature's filters.

## Templates

```csharp
// <% backend.src_dir %>/Features/EntityNames/Models/EntityNameModels.cs
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
// <% backend.common_dir %>/Models/PaginationQuery.cs
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

<% sections.mapping %>
