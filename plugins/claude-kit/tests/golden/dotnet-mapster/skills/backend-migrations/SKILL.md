---
name: backend-migrations
description: Use when creating or managing EF Core migrations after changing an entity or its configuration. Covers dotnet ef commands, naming conventions, reviewing the generated migration, and common pitfalls.
---

# Skill: EF Core Migrations

## When to Create a Migration
- After adding a new entity (and its `IEntityTypeConfiguration`)
- After adding, removing or renaming a property
- After changing indexes, relationships, or constraints
- After changing a column's type, length, nullability, or default

## Commands

Run from **`src/MapsterShop.Api`** (where the `.csproj` and the `DbContext` live):

### Generate a migration
```bash
cd src/MapsterShop.Api
dotnet ef migrations add <MigrationName> --output-dir Data/Migrations
```

This diffs the model against `AppDbContextModelSnapshot.cs`, writes a timestamped migration into
`Data/Migrations/`, and updates the snapshot. It does **not** touch the database.

### Apply pending migrations
```bash
dotnet ef database update
```

### Undo the last migration (only if it has NOT been applied or committed)
```bash
dotnet ef migrations remove
```

### Naming Convention
Describe **what changed**, PascalCase:

| Change | Migration Name |
|--------|---------------|
| New entity `Property` | `AddPropertyTable` |
| Add `Email` to `Contact` | `AddEmailToContact` |
| Add index on `Contact.Email` | `AddEmailIndexToContact` |
| Remove `Fax` from `Contact` | `RemoveFaxFromContact` |
| Add FK from `Deal` to `Contact` | `AddContactToDeal` |

## Checklist Before Generating
- [ ] Entity derives from `AuditedEntity`
- [ ] An `IEntityTypeConfiguration<T>` exists in `src/MapsterShop.Api/Data/Configurations/` with `ToTable`, `HasKey`, and lengths
- [ ] Relationships declare an explicit `OnDelete` (usually `Restrict`)
- [ ] FKs have a `HasIndex`
- [ ] The project builds (`dotnet build`) — `dotnet ef` builds first and will fail on a compile error

## After Generating
- [ ] **Open the generated migration and read it.** This is the step people skip and regret.
- [ ] Verify column types, nullability and defaults match intent
- [ ] Verify FK names and `ON DELETE` behaviour
- [ ] A rename generated as Drop + Add **loses data** — replace it with `migrationBuilder.RenameColumn`
- [ ] Commit the migration, its `.Designer.cs`, **and** the updated `AppDbContextModelSnapshot.cs` together
- [ ] Never hand-edit a migration that has been applied or committed — generate a new one

## Common Issues

### Empty migration (no changes detected)
The snapshot already matches the model. Usually the configuration was not picked up — confirm the
class implements `IEntityTypeConfiguration<T>` and lives in the assembly scanned by
`ApplyConfigurationsFromAssembly`.

### "Unable to create a DbContext"
`dotnet ef` builds and instantiates the app. Either the build fails, or `Program.cs` needs a
connection string that is not present. Ensure the `ConnectionStrings__Default` env var or
`appsettings.Development.json` is available.

### Snapshot conflict after a merge
Two branches each generated a migration. Do **not** hand-merge the snapshot: remove your migration
(`dotnet ef migrations remove`), take theirs, re-apply, then regenerate yours on top.

### A rename silently drops data
EF Core cannot tell a rename from a drop-plus-add. Always read the generated file and convert it to
`RenameColumn`/`RenameTable` by hand when that is what you meant.
