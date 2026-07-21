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

<% sections.provider %>

<% sections.crud_base %>

## Service

- CRUD services extend `CrudService` and point `table` at their table
- Non-CRUD services are plain `@Injectable()` classes
- Inject the `DRIZZLE` token; never `new` a client
- Select only needed columns (`.select({ ... })`) to avoid over-fetching
- Always `async`/`await` database and I/O calls
- Shape responses via a partial `select` or a small mapper — never leak audit/soft-delete internals

```typescript
// <% backend.src_dir %>/entity-name/entity-name.service.ts
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
// <% backend.src_dir %>/entity-name/entity-name.controller.ts
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
// <% backend.src_dir %>/entity-name/entity-name.module.ts
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
- [ ] Feature lives under `<% backend.src_dir %>/<feature>/` with `.module.ts`, `.controller.ts`, `.service.ts`
- [ ] Controller registered in the module's `controllers`, service in `providers`
- [ ] Module imported by `AppModule` (or a parent feature module)
- [ ] Every route explicitly annotated (`@Get/@Post/@Put/@Delete`) and grouped with `@ApiTags`
- [ ] Data access goes through the injected `db` and excludes soft-deleted rows (`<% orm.read_filter %>`); reads `select` only needed columns and return response DTOs, not raw rows
