## Reusable CRUD base

Shared CRUD plumbing lives in `<% backend.common_dir %>/crud/`. The base is soft-delete-aware,
generic in the table, its key and the four models a feature exposes, and it applies paging,
filtering and sorting for you.

```typescript
// <% backend.common_dir %>/crud/crud.service.ts  (shape — read the file for the internals)
export type CrudTable = PgTable & { id: PgColumn; isDeleted: PgColumn; createdAt: PgColumn };

export abstract class CrudService<
  TTable extends CrudTable,
  TId,
  TCreate,
  TUpdate extends { id: TId },
  TListRequest extends BasePaginatedRequestDto,
  TListItem,
> {
  protected abstract readonly table: TTable;

  // Columns a client may filter/sort on, keyed by the name the client sends.
  protected readonly filterable: Record<string, PgColumn> = {};
  protected readonly sortable: Record<string, PgColumn> = {};

  constructor(protected readonly db: Database) {}

  protected abstract toListItem(row: TTable['$inferSelect']): TListItem;

  protected applyCustomFilters(request: TListRequest): SQL | undefined;

  getListing(request: TListRequest): Promise<PagedResult<TListItem>>;
  create(input: TCreate): Promise<TId>;
  update(input: TUpdate): Promise<TId>;   // id travels on the model
  delete(id: TId): Promise<void>;         // soft delete

  protected findOne(id: TId): Promise<TTable['$inferSelect']>;   // throws NotFoundException
}
```

### The four methods

| Method | Takes | Returns |
|---|---|---|
| `getListing` | `TListRequest` (a `BasePaginatedRequestDto`) | `PagedResult<TListItem>` |
| `create` | `TCreate` | the new `TId` |
| `update` | `TUpdate` (carries the id) | the `TId` |
| `delete` | `TId` | nothing — sets `isDeleted` |

Writes return the **id**, not the row. A row is a persistence concern, and handing one back invites
it into a response payload. A caller that needs the saved record reads it back — start from the
base's `findOne`, which already excludes soft-deleted rows and throws `NotFoundException`.

### Filtering and sorting

`BasePaginatedRequestDto` carries `page`, `pageSize`, `filters` and `sorters`. The base applies all
three, but **only over columns the service allowlists**:

```typescript
protected readonly filterable = { name: entityNames.name, status: entityNames.status };
protected readonly sortable = { name: entityNames.name, createdAt: entityNames.createdAt };
```

The keys are the names clients send; the values are the actual columns. Both maps are empty by
default, so a new listing exposes no query surface until it says so — adding a column to a table
never silently adds a filter to its API. A field outside the map throws `BadRequestException` → 400.

Sorting is always a **total order**: your sorters, then `createdAt` descending if you supplied none,
then `id`. That last clause is not decoration — without it two rows with equal sort keys can swap
between requests, and the client sees one row twice while never seeing another.

For anything the descriptors cannot express — a join, a computed predicate, tenant scoping —
override `applyCustomFilters`. It composes with the descriptors rather than replacing them:

```typescript
protected applyCustomFilters(request: EntityNamePaginationDto): SQL | undefined {
  return request.mineOnly ? eq(entityNames.ownerId, this.currentUserId) : undefined;
}
```

`Contains` and `StartsWith` compile to `ILIKE`, which is case-insensitive in Postgres, and `%`/`_`
in the client's value are escaped so a search for `50%` finds the literal characters.

`getListing` selects the full row and maps it through `toListItem`. That is right for a page of at
most a few hundred rows. A listing that must avoid loading wide columns should write its own query
with an explicit `select({ ... })` rather than going through the base.
