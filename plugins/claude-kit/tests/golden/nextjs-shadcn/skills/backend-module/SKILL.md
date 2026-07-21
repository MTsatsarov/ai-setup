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
soft-delete-aware Drizzle access; the base controller centralizes route shape and Swagger docs.

```typescript
// apps/api/src/common/crud/crud.service.ts
import { NotFoundException } from '@nestjs/common';
import { and, eq, SQL } from 'drizzle-orm';
import type { Database } from '../db/drizzle.module';

// TTable is any pgTable carrying id / isDeleted.
export abstract class CrudService<TTable extends { id: any; isDeleted: any }> {
  protected abstract readonly table: TTable;

  constructor(protected readonly db: Database) {}

  findAll(extra?: SQL) {
    return this.db.select().from(this.table as any).where(and(eq(this.table.isDeleted, false), extra));
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select()
      .from(this.table as any)
      .where(and(eq(this.table.isDeleted, false), eq(this.table.id, id)))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Not found: ${id}`);
    }
    return row;
  }

  async create(data: object) {
    const [row] = await this.db.insert(this.table as any).values(data).returning();
    return row;
  }

  async update(id: string, data: object) {
    const [row] = await this.db
      .update(this.table as any)
      .set(data)
      .where(and(eq(this.table.isDeleted, false), eq(this.table.id, id)))
      .returning();
    if (!row) {
      throw new NotFoundException(`Not found: ${id}`);
    }
    return row;
  }

  // Soft delete — sets isDeleted rather than removing the row.
  remove(id: string) {
    return this.db
      .update(this.table as any)
      .set({ isDeleted: true })
      .where(and(eq(this.table.isDeleted, false), eq(this.table.id, id)));
  }
}
```

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
