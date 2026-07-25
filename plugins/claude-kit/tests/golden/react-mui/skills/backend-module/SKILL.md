---
name: backend-module
description: Use when creating or modifying a NestJS feature module, REST controller, or service. Covers the module/controller/service triad, a reusable CRUD base service, DTO in/out, and Swagger tags.
---

# Skill: NestJS Feature Module Pattern

## Key Concept
In NestJS the API layer is **explicit**: a `@Controller` declares routes with `@Get/@Post/@Put/@Delete`,
delegates to an injectable `@Injectable()` service, and both are wired through a feature `@Module`.
Every endpoint is a method you write and annotate. Data access goes through the injected
`db` — never a raw client.

### URL Convention
- Base path: `@Controller('entity-names')` → `/entity-names`
- Verbs map to CRUD: `GET /` (list), `GET /:id` (details), `POST /` (create), `PUT /:id` (update), `DELETE /:id`
- Tag the controller with `@ApiTags('EntityNames')` so it groups in Swagger

## The Drizzle provider

Expose the typed `db` as an injectable so services depend on it via DI:

```typescript
// apps/api/src/common/db/drizzle.module.ts
import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';

export const DRIZZLE = Symbol('DRIZZLE');
export type Database = ReturnType<typeof drizzle<typeof schema>>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema }),
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
```

## Reusable CRUD base

Shared CRUD plumbing lives in `apps/api/src/common/crud/`. The base is soft-delete-aware,
generic in the table, its key and the four models a feature exposes, and it applies paging,
filtering and sorting for you.

```typescript
// apps/api/src/common/crud/crud.service.ts  (shape — read the file for the internals)
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

## Service

- CRUD services extend `CrudService`, point `table` at their table, and declare their
  `filterable`/`sortable` allowlists — the four CRUD methods come from the base
- Non-CRUD services are plain `@Injectable()` classes
- Inject the `DRIZZLE` token; never `new` a client
- Select only needed columns (`.select({ ... })`) to avoid over-fetching
- Always `async`/`await` database and I/O calls
- Shape responses via a partial `select` or a small mapper — never leak audit/soft-delete internals

```typescript
// apps/api/src/entity-name/entity-name.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, SQL } from 'drizzle-orm';
import { CrudService } from '../common/crud/crud.service';
import { DRIZZLE, type Database } from '../common/db/drizzle.module';
import { entityNames } from '../db/schema';
import {
  CreateEntityNameDto,
  EntityNameListItemDto,
  EntityNamePaginationDto,
  UpdateEntityNameDto,
} from './dto/entity-name.dto';

@Injectable()
export class EntityNameService extends CrudService<
  typeof entityNames,
  string,
  CreateEntityNameDto,
  UpdateEntityNameDto,
  EntityNamePaginationDto,
  EntityNameListItemDto
> {
  protected readonly table = entityNames;

  // The listing's entire query surface. Nothing outside these maps is filterable
  // or sortable, however tempting the column.
  protected readonly filterable = {
    name: entityNames.name,
    relatedEntityId: entityNames.relatedEntityId,
    createdAt: entityNames.createdAt,
  };

  protected readonly sortable = {
    name: entityNames.name,
    createdAt: entityNames.createdAt,
  };

  constructor(@Inject(DRIZZLE) db: Database) {
    super(db);
  }

  protected toListItem(row: typeof entityNames.$inferSelect): EntityNameListItemDto {
    return { id: row.id, name: row.name };
  }

  // A filter the descriptors cannot express — ANDed with them, not instead of them.
  protected applyCustomFilters(request: EntityNamePaginationDto): SQL | undefined {
    return request.mineOnly ? eq(entityNames.ownerId, this.currentUserId) : undefined;
  }

  // Details read — the one part of CRUD whose shape is genuinely per-feature.
  async getDetails(id: string) {
    const row = await this.findOne(id);
    return { id: row.id, name: row.name, relatedEntityId: row.relatedEntityId };
  }

  // Simple query — select only what's needed
  findByName(name: string) {
    return this.db
      .select({ id: entityNames.id, name: entityNames.name })
      .from(entityNames)
      .where(and(eq(entityNames.isDeleted, false), eq(entityNames.name, name)))
      .limit(1);
  }
}
```

`getListing`, `create`, `update` and `delete` are inherited — there is nothing to write. That
leaves the allowlists, `toListItem`, and the details read.

## Controller

```typescript
// apps/api/src/entity-name/entity-name.controller.ts
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EntityNameService } from './entity-name.service';
import {
  CreateEntityNameDto,
  EntityNamePaginationDto,
  UpdateEntityNameDto,
} from './dto/entity-name.dto';

@ApiTags('EntityNames')
@Controller('entity-names')
export class EntityNameController {
  constructor(private readonly service: EntityNameService) {}

  @Get()
  getListing(@Query() request: EntityNamePaginationDto) {
    return this.service.getListing(request);
  }

  @Get(':id')
  getDetails(@Param('id') id: string) {
    return this.service.getDetails(id);
  }

  @Post()
  create(@Body() dto: CreateEntityNameDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEntityNameDto) {
    // The id is in both the route and the body. They must agree, or the request
    // is claiming to update one row while naming another.
    if (id !== dto.id) {
      throw new BadRequestException(`Route id ${id} does not match body id ${dto.id}.`);
    }
    return this.service.update(dto);
  }

  @Delete(':id')
  @HttpCode(204)   // Nest returns 200 by default; a delete with no body is a 204
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
```

### Binding a paginated request

`@Query()` binds `page`/`pageSize` directly and the descriptor lists by index — the global
`ValidationPipe` (with `transform: true`) turns them into real `FilterDescriptorDto` instances:

```
GET /entity-names
  ?page=2&pageSize=20
  &filters[0][field]=name&filters[0][operator]=Contains&filters[0][value]=acme
  &sorters[0][field]=createdAt&sorters[0][descending]=true
```

The indexed form is not guessable — document it in the endpoint's Swagger summary for anyone
writing a client by hand.

This depends on `app.set('query parser', 'extended')` in `main.ts`. Express 5 defaults to the
`simple` parser, which does not parse brackets: without that line `filters` arrives as an empty
array and **every filter is silently ignored**. Do not remove it.

## Module

```typescript
// apps/api/src/entity-name/entity-name.module.ts
import { Module } from '@nestjs/common';
import { EntityNameController } from './entity-name.controller';
import { EntityNameService } from './entity-name.service';

@Module({
  controllers: [EntityNameController],
  providers: [EntityNameService],
  exports: [EntityNameService],
})
export class EntityNameModule {}
```
(`DrizzleModule` is `@Global`, so features don't re-import it.)

## Checklist
- [ ] Feature lives under `apps/api/src/<feature>/` with `.module.ts`, `.controller.ts`, `.service.ts`
- [ ] Controller registered in the module's `controllers`, service in `providers`
- [ ] Module imported by `AppModule` (or a parent feature module)
- [ ] CRUD service extends `CrudService`, sets `table`, `filterable`, `sortable` and `toListItem`
- [ ] `filterable`/`sortable` list only what the API should expose
- [ ] `update` rejects a route id that disagrees with the body id
- [ ] Every route explicitly annotated (`@Get/@Post/@Put/@Delete`) and grouped with `@ApiTags`
- [ ] Data access goes through the injected `db` and excludes soft-deleted rows (`eq(table.isDeleted, false)`); reads `select` only needed columns and return response DTOs, not raw rows
