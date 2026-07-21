## Mapping with AutoMapper

One `Profile` per feature, beside the service. Registered once by assembly scan:

```csharp
// Program.cs
builder.Services.AddAutoMapper(cfg => cfg.AddMaps(typeof(Program).Assembly));
```

```csharp
// <% backend.src_dir %>/Features/EntityNames/EntityNameProfile.cs
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
