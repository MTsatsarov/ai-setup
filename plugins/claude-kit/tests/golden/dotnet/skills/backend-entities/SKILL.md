---
name: backend-entities
description: Use when creating or modifying EF Core entities, their IEntityTypeConfiguration, or DbSet registration. Covers the shared audited base, the global soft-delete filter, relationships, and indexes.
---

# Skill: EF Core Entities

## Entity Definition

- Entities live **beside their feature** (`src/DemoCRM.Api/Features/<Feature>/EntityName.cs`), not in a shared Entities folder
- Every domain entity derives from `AuditedEntity`, which carries `Id`, `CreatedAt`, `UpdatedAt`, `IsDeleted`
- Mapping lives in an `IEntityTypeConfiguration<T>` under `src/DemoCRM.Api/Data/Configurations/` — **never** in `OnModelCreating` directly
- `AppDbContext` picks configurations up with `ApplyConfigurationsFromAssembly`, so there is no DbSet to register by hand

### The shared audited base

```csharp
// src/DemoCRM.Api/Common/Entities/AuditedEntity.cs
public abstract class AuditedEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsDeleted { get; set; }
}
```

### Property Rules
- Set once at creation, never changed → set in the constructor/initializer; keep it out of the update request
- Mutable from the API → include in the update request
- Managed by the system (audit, soft-delete) → set by the base or `SaveChangesAsync`, never by the client

### Template

```csharp
// src/DemoCRM.Api/Features/EntityNames/EntityName.cs
public class EntityName : AuditedEntity
{
    public string Name { get; set; } = string.Empty;
    public Guid? RelatedEntityId { get; set; }
    public RelatedEntity? RelatedEntity { get; set; }
}

public class RelatedEntity : AuditedEntity
{
    public string Name { get; set; } = string.Empty;
    public ICollection<EntityName> EntityNames { get; set; } = [];
}
```

```csharp
// src/DemoCRM.Api/Data/Configurations/EntityNameConfiguration.cs
public class EntityNameConfiguration : IEntityTypeConfiguration<EntityName>
{
    public void Configure(EntityTypeBuilder<EntityName> builder)
    {
        builder.ToTable("entity_names");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Name).HasMaxLength(200).IsRequired();

        builder.HasOne(e => e.RelatedEntity)
            .WithMany(r => r.EntityNames)
            .HasForeignKey(e => e.RelatedEntityId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(e => e.RelatedEntityId);
    }
}
```

## Soft-delete filtering

Unlike a hand-filtered ORM, soft delete here is **automatic**. `AppDbContext` applies a global
query filter to every type deriving from `AuditedEntity`:

```csharp
// src/DemoCRM.Api/Common/Data/AppDbContext.cs — inside OnModelCreating
foreach (var entityType in modelBuilder.Model.GetEntityTypes())
{
    if (!typeof(AuditedEntity).IsAssignableFrom(entityType.ClrType))
    {
        continue;
    }

    var parameter = Expression.Parameter(entityType.ClrType, "e");
    var property = Expression.Property(parameter, nameof(AuditedEntity.IsDeleted));
    var filter = Expression.Lambda(Expression.Equal(property, Expression.Constant(false)), parameter);

    entityType.SetQueryFilter(filter);
}
```

Consequences worth internalising:

- **Reads need no filter.** Every query excludes deleted rows already. Adding `.Where(e => !e.IsDeleted)` is redundant.
- **`IgnoreQueryFilters()` is the escape hatch** and needs a written reason at the call site.
- **Deletes are `IsDeleted = true`**, never `Remove(entity)`.
- **The filter does not cascade through a required FK.** If a parent is soft-deleted, its children remain visible unless they are soft-deleted too — cascade it explicitly in the service.

## Relationships
- One-to-many: the child owns the FK (`ParentId` + a navigation property); configure both sides in the child's configuration
- `DeleteBehavior.Restrict` for referential safety; `Cascade` only for genuinely owned children
- Add `HasIndex` on every FK you filter or join on
- Load children with `Include`, or better, let `ProjectTo` select only what the DTO needs
