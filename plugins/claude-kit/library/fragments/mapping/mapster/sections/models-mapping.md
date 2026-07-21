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
// <% backend.src_dir %>/Features/EntityNames/EntityNameMapping.cs
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
