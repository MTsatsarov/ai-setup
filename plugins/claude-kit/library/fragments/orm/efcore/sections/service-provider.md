## The DbContext

`AppDbContext` is registered once and injected into every service. It applies configurations from
the assembly and installs the global soft-delete filter:

```csharp
// Program.cs
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

It is **scoped** — one instance per request. Any service holding it must also be scoped.
