## Mapping manually

No library. The response shape is produced by the query itself, and anything computed goes through
a small pure function.

### Shape the response in the query

```csharp
await Query
    .Where(e => e.Id == id)
    .Select(e => new EntityNameDetails(
        e.Id,
        e.Name,
        e.RelatedEntityId,
        e.RelatedEntity != null ? e.RelatedEntity.Name : null,
        e.CreatedAt))
    .FirstOrDefaultAsync(ct);
```

This is the whole trick: `Select` into the record's constructor and the projection becomes SQL,
selecting exactly those columns with no `Include` needed.

### Computed or reshaped fields go in a pure mapper

```csharp
// <% backend.src_dir %>/Features/EntityNames/EntityNameMapper.cs
public static class EntityNameMapper
{
    public static EntityNameDetails ToDetails(EntityName e) => new(
        e.Id,
        e.Name,
        e.RelatedEntityId,
        e.RelatedEntity?.Name,
        e.CreatedAt);

    public static void Apply(UpdateEntityNameRequest input, EntityName entity)
    {
        // Only these fields are client-settable. Everything else is server-owned,
        // and the compiler now enforces that rather than a config file.
        entity.Name = input.Name;
        entity.RelatedEntityId = input.RelatedEntityId;
    }
}
```

### Rules
- **A mapper used inside a query must be an expression EF Core can translate.** A static method
  call inside `Select` will not translate — inline the projection, or accept that it runs in memory.
- `Apply` is the update path, and it is deliberately explicit: adding a property to the entity does
  **not** silently make it client-writable. That is the main advantage over a convention-based mapper.
- Keep mappers pure and static — no injected services, no database access.
- The cost is duplication between the listing and details projections. Accept it; the day they need
  to differ, you will not have to untangle a shared mapping config.
