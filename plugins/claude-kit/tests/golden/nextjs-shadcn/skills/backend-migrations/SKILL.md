---
name: backend-migrations
description: Use when creating or managing Drizzle database migrations after modifying the schema. Covers drizzle-kit generate/migrate commands, naming conventions, reviewing generated SQL, and common pitfalls.
---

# Skill: Drizzle Migrations

## When to Create a Migration
- After adding a new table to `apps/api/src/db/schema/`
- After modifying columns (add/remove/rename)
- After changing indexes, relations, or constraints (`.references()`, `index()`, `unique()`)
- After changing enums or default values

## Setup

`drizzle-kit` reads `drizzle.config.ts` at the api root. Migrations are written to the
`apps/api/drizzle/` folder and applied by a migrator on boot or via CLI.

```typescript
// apps/api/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Commands

Run from **`apps/api`** (where `drizzle.config.ts` and `DATABASE_URL` live):

### Generate a migration (diff the schema → SQL)
```bash
cd apps/api
npx drizzle-kit generate --name <migration_name>
```
This diffs the TS schema against the last snapshot in `drizzle/meta/`, writes a timestamped
`drizzle/<timestamp>_<name>.sql`, and updates the snapshot. It does **not** touch the database.

### Apply pending migrations
```bash
npx drizzle-kit migrate       # applies committed SQL migrations in order
```

### Naming Convention
Describe **what changed** in lower_snake_case:

| Change | Migration Name |
|--------|---------------|
| New table `property` | `add_property_table` |
| Add column `email` to `contact` | `add_email_to_contact` |
| Add index on `contact.email` | `add_email_index_to_contact` |
| Remove column `fax` from `contact` | `remove_fax_from_contact` |
| Add FK from `deal` to `contact` | `add_contact_to_deal` |

### Prototyping only — push (no migration file)
```bash
npx drizzle-kit push          # syncs the DB to the schema WITHOUT a migration file
```
Use only on a throwaway local DB. Never use `push` for shared/committed changes — it leaves no
migration history.

## Checklist Before Generating
- [ ] Table exists in `apps/api/src/db/schema/` (and is re-exported from `schema/index.ts`) with the shared audit + soft-delete columns
- [ ] Relations declare an explicit `onDelete` (typically `'restrict'`)
- [ ] FKs have an `index()`
- [ ] The TS project compiles (`tsc --noEmit`) before generating

## After Generating
- [ ] Open the generated `drizzle/<timestamp>_<name>.sql` and review it
- [ ] Verify column types, nullability, and defaults match your intent
- [ ] Verify foreign-key names and `ON DELETE` behavior
- [ ] Commit the SQL file **and** the updated `drizzle/meta/` snapshot together with the schema change
- [ ] Do **NOT** hand-edit a migration that's already been applied/committed — generate a new one instead

## Common Issues

### Snapshot drift / out-of-order migrations
The `drizzle/meta/_journal.json` + snapshots track history. If a teammate's migration isn't
applied locally, run `npx drizzle-kit migrate` to catch up before generating — never hand-merge SQL.

### Empty migration (no changes detected)
- The schema change wasn't saved, or the table isn't re-exported from `schema/index.ts`
- `drizzle.config.ts` `schema` path doesn't point at the changed file

### Migration has unexpected changes
The snapshot is behind. Pull latest, apply pending migrations, then generate — the diff should be
only your change.

### `DATABASE_URL` not found
`drizzle-kit` reads env from the process; ensure `.env` is loaded (e.g. `dotenv -e .env -- drizzle-kit ...`) or the var is exported.
