---
name: backend-entities
description: Use when creating or modifying Drizzle schema tables, audit/soft-delete base columns, or relations. Covers the shared base columns, soft-delete filtering, pgTable definitions, and relations().
---

# Skill: Drizzle Schema (Tables) Pattern

## Table Definition

- Schema lives in `apps/api/src/db/schema/` — one file per feature (e.g. `entity-name.ts`), re-exported from `apps/api/src/db/schema/index.ts`
- Every domain table spreads the shared audit + soft-delete columns (`createdAt`, `updatedAt`, `isDeleted`)
- Drizzle schema is **hand-written TypeScript** and is the source of truth; `drizzle-kit generate` derives SQL migrations from it (see `backend-migrations`)
- Declare relations with `relations()` so the relational query API (`db.query.*`) can use `with`

### Shared base columns

Keep the audit/soft-delete columns in one place and spread them into every table so they stay consistent:

```typescript
// apps/api/src/db/schema/_shared.ts
import { boolean, timestamp } from 'drizzle-orm/pg-core';

// audit + soft delete — spread into every domain table
export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
};
```

### Column Rules
- Set once at creation, never changed → set by default; keep it out of the update DTO
- Mutable from the API → include in the update DTO
- Managed by the system (audit, soft-delete) → set by defaults / the service, never by the client

### Template

```typescript
// apps/api/src/db/schema/entity-name.ts
import { index, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { auditColumns } from './_shared';
import { relatedEntities } from './related-entity';
import { childEntities } from './child-entity';

export const entityNames = pgTable(
  'entity_names',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),

    // --- relations (FK columns) ---
    relatedEntityId: uuid('related_entity_id').references(() => relatedEntities.id, {
      onDelete: 'restrict',
    }),

    // --- audit/soft-delete (shared) ---
    ...auditColumns,
  },
  (t) => ({
    relatedIdx: index('entity_names_related_idx').on(t.relatedEntityId),
  }),
);

export const entityNamesRelations = relations(entityNames, ({ one, many }) => ({
  relatedEntity: one(relatedEntities, {
    fields: [entityNames.relatedEntityId],
    references: [relatedEntities.id],
  }),
  childEntities: many(childEntities),
}));
```

## Soft-delete filtering

Rows are soft-deleted by setting `isDeleted` to `true` rather than removing them, so **every read must exclude
soft-deleted rows**. Drizzle has no query middleware — inline `eq(table.isDeleted, false)` into the
`where` of each query (compose it with `and()` alongside the feature filters).

```typescript
// usage in a service
const rows = await this.db
  .select()
  .from(entityNames)
  .where(and(eq(entityNames.isDeleted, false), eq(entityNames.id, id)));
```

- **Reads**: always `and(eq(table.isDeleted, false), ...)`
- **Deletes**: prefer a **soft delete** — `db.update(table).set({ isDeleted: true })` instead of `db.delete(...)`

## Relations
- One-to-many: the child table owns the FK column (`parentEntityId` + `.references()`); declare `many()`/`one()` in both `relations()`
- Use `onDelete: 'restrict'` for referential safety; `'cascade'` only for truly owned children
- Add an `index()` on every FK you filter/join on
- Use the relational query API for reads that need children: `db.query.entityNames.findMany({ with: { childEntities: true } })`
