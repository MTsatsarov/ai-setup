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

Put shared CRUD plumbing in `apps/api/src/common/crud/`. The base service centralizes
soft-delete-aware Drizzle access so no feature service re-implements it.

```typescript
// apps/api/src/common/crud/crud.service.ts
import { NotFoundException } from '@nestjs/common';
import { and, eq, SQL } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../db/drizzle.module';

// Any pgTable carrying the id + isDeleted columns this base relies on.
export type CrudTable = PgTable & { id: PgColumn; isDeleted: PgColumn };

export abstract class CrudService<TTable extends CrudTable> {
  protected abstract readonly table: TTable;

  constructor(protected readonly db: Database) {}

  // Drizzle's query-builder types are conditional on a *concrete* table, so
  // they cannot resolve against an unresolved generic. The cast is confined to
  // this accessor; every public signature below stays typed via $inferSelect /
  // $inferInsert, so callers lose nothing.
  private get t(): any {
    return this.table;
  }

  private get notDeleted(): SQL | undefined {
    return eq(this.table.isDeleted, false);
  }

  findAll(extra?: SQL): Promise<TTable['$inferSelect'][]> {
    return this.db.select().from(this.t).where(and(this.notDeleted, extra));
  }

  async findOne(id: string): Promise<TTable['$inferSelect']> {
    const rows: TTable['$inferSelect'][] = await this.db
      .select()
      .from(this.t)
      .where(and(this.notDeleted, eq(this.table.id, id)))
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException(`Not found: ${id}`);
    }
    return rows[0];
  }

  async create(data: TTable['$inferInsert']): Promise<TTable['$inferSelect']> {
    // insert().returning() widens to `any[] | QueryResult<never>`; the assertion
    // narrows it back rather than letting the union leak into the public type.
    const rows = (await this.db.insert(this.t).values(data).returning()) as TTable['$inferSelect'][];
    return rows[0];
  }

  async update(
    id: string,
    data: Partial<TTable['$inferInsert']>,
  ): Promise<TTable['$inferSelect']> {
    const rows: TTable['$inferSelect'][] = await this.db
      .update(this.t)
      .set(data)
      .where(and(this.notDeleted, eq(this.table.id, id)))
      .returning();
    if (!rows[0]) {
      throw new NotFoundException(`Not found: ${id}`);
    }
    return rows[0];
  }

  // Soft delete — sets isDeleted rather than removing the row.
  async remove(id: string): Promise<void> {
    await this.db
      .update(this.t)
      .set({ isDeleted: true })
      .where(and(this.notDeleted, eq(this.table.id, id)));
  }
}
```

**Do not** write `const [row] = await ...` against these builders, and do not spread
`as any` across each call. Both compile-fail on current `drizzle-orm`: destructuring hits
`Type '... | QueryResult<never>' must have a '[Symbol.iterator]()' method`, and a
per-call `as any` discards the inferred row type. Index with `rows[0]` and keep the cast
in the `t` accessor.

## Service

- CRUD services extend `CrudService` and point `table` at their table
- Non-CRUD services are plain `@Injectable()` classes
- Inject the `DRIZZLE` token; never `new` a client
- Select only needed columns (`.select({ ... })`) to avoid over-fetching
- Always `async`/`await` database and I/O calls
- Shape responses via a partial `select` or a small mapper — never leak audit/soft-delete internals

```typescript
// apps/api/src/entity-name/entity-name.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike } from 'drizzle-orm';
import { CrudService } from '../common/crud/crud.service';
import { DRIZZLE, type Database } from '../common/db/drizzle.module';
import { entityNames } from '../db/schema';
import { EntityNamePaginationDto } from './dto/entity-name-pagination.dto';

@Injectable()
export class EntityNameService extends CrudService<typeof entityNames> {
  protected readonly table = entityNames;

  constructor(@Inject(DRIZZLE) db: Database) {
    super(db);
  }

  // Simple query — select only what's needed
  findByName(name: string) {
    return this.db
      .select({ id: entityNames.id, name: entityNames.name, relatedEntityId: entityNames.relatedEntityId })
      .from(entityNames)
      .where(and(eq(entityNames.isDeleted, false), eq(entityNames.name, name)))
      .limit(1);
  }

  list(query: EntityNamePaginationDto) {
    return this.db
      .select()
      .from(entityNames)
      .where(and(eq(entityNames.isDeleted, false), query.name ? ilike(entityNames.name, `%${query.name}%`) : undefined))
      .offset(query.skip)
      .limit(query.take);
  }
}
```

## Controller

```typescript
// apps/api/src/entity-name/entity-name.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EntityNameService } from './entity-name.service';
import { CreateEntityNameDto } from './dto/create-entity-name.dto';
import { UpdateEntityNameDto } from './dto/update-entity-name.dto';
import { EntityNamePaginationDto } from './dto/entity-name-pagination.dto';

@ApiTags('EntityNames')
@Controller('entity-names')
export class EntityNameController {
  constructor(private readonly service: EntityNameService) {}

  @Get()
  findAll(@Query() query: EntityNamePaginationDto) {
    return this.service.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateEntityNameDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEntityNameDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

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
- [ ] Every route explicitly annotated (`@Get/@Post/@Put/@Delete`) and grouped with `@ApiTags`
- [ ] Data access goes through the injected `db` and excludes soft-deleted rows (`eq(table.isDeleted, false)`); reads `select` only needed columns and return response DTOs, not raw rows
