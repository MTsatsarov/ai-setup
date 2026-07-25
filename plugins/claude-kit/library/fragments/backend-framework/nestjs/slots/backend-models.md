---
name: backend-models
description: Use when creating or modifying request/response DTOs in a feature's dto folder. Covers class-validator/class-transformer decorators, the PaginationQueryDto base, and response shaping via a partial select or a mapper.
---

# Skill: DTOs Pattern

## Overview
DTOs live in the `dto/` folder within each feature (`<% backend.src_dir %>/<feature>/dto/`). Request DTOs are validated by class-validator (via the global `ValidationPipe`) and transformed by class-transformer. Responses are shaped either by a partial `select` or a small mapper — never by returning raw table rows.

## Roles
- **Create/Update DTOs** — validated input (DTO → persisted data). Decorate every field. The
  update DTO carries the `id`, because the CRUD base reads it off the model; a create DTO never does.
- **Response DTOs** — the public shape returned to clients (record → DTO). Expose via `@ApiProperty` for Swagger; keep audit/soft-delete internals out.
- **Pagination DTO** — extends `BasePaginatedRequestDto`, adding only what the generic filters cannot express.

## Templates

```typescript
// <% backend.src_dir %>/entity-name/dto/create-entity-name.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateEntityNameDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;
}
```

```typescript
// <% backend.src_dir %>/entity-name/dto/update-entity-name.dto.ts
import { PartialType } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateEntityNameDto } from './create-entity-name.dto';

// All create fields optional; validation decorators are inherited. The id is
// required and not optional — the CRUD base reads it off the model.
export class UpdateEntityNameDto extends PartialType(CreateEntityNameDto) {
  @ApiProperty()
  @IsUUID()
  id: string;
}
```

```typescript
// <% backend.src_dir %>/entity-name/dto/entity-name.response.ts
import { ApiProperty } from '@nestjs/swagger';

export class ChildEntityResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

// Details response — full shape
export class EntityNameDetailsResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ required: false }) relatedEntityId?: string;
  @ApiProperty({ required: false }) relatedEntityName?: string;
  @ApiProperty({ type: [ChildEntityResponseDto] })
  childEntities: ChildEntityResponseDto[];
}

// Listing response — lighter shape
export class EntityNameListingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: [ChildEntityResponseDto] })
  childEntities: ChildEntityResponseDto[];
}
```

```typescript
// <% backend.common_dir %>/dto/base-paginated-request.dto.ts   (shape — read the file for the decorators)
export enum FilterOperator {
  Equals, NotEquals, Contains, StartsWith,
  GreaterThan, GreaterThanOrEqual, LessThan, LessThanOrEqual,
  In, IsNull, IsNotNull,
}

export class FilterDescriptorDto {
  field: string;
  operator: FilterOperator = FilterOperator.Equals;
  value?: string;              // parsed to the column's type; comma-separated for In
}

export class SortDescriptorDto {
  field: string;
  descending = false;
}

export class BasePaginatedRequestDto {
  page = 1;                    // @Min(1)
  pageSize = 20;               // @Min(1) @Max(200)
  filters: FilterDescriptorDto[] = [];
  sorters: SortDescriptorDto[] = [];
  get skip(): number { return (this.page - 1) * this.pageSize; }
}

export interface PagedResult<T> {
  items: T[]; total: number; page: number; pageSize: number; totalPages: number;
}
```

`field` is not free-form: it is matched against the service's `filterable`/`sortable` allowlist,
and anything else is a 400. See the module skill.

```typescript
// <% backend.src_dir %>/entity-name/dto/entity-name-pagination.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { BasePaginatedRequestDto } from '../../common/dto/base-paginated-request.dto';

// page, pageSize, filters and sorters come from the base. Add a property here
// only for a filter the descriptors cannot express — one the service reads in
// applyCustomFilters. Ordinary column filters need no property at all.
export class EntityNamePaginationDto extends BasePaginatedRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mineOnly?: boolean;
}
```

Note the `@Transform` rather than `@Type(() => Boolean)`: `Boolean('false')` is `true`, so
`@Type` would make a boolean query param impossible to turn off.

## Response shaping

Prefer a partial `select` (with joins for related names) so the query returns close to the
response shape without over-fetching:

```typescript
this.db
  .select({
    id: entityNames.id,
    name: entityNames.name,
    relatedEntityId: entityNames.relatedEntityId,
    relatedEntityName: relatedEntities.name,
  })
  .from(entityNames)
  .leftJoin(relatedEntities, eq(relatedEntities.id, entityNames.relatedEntityId))
  .where(and(eq(entityNames.isDeleted, false), eq(entityNames.id, id)))
  .limit(1);
```

For nested collections, use the relational query API instead of a flat join:

```typescript
this.db.query.entityNames.findFirst({
  where: (t, { and, eq }) => and(eq(t.id, id), eq(t.isDeleted, false)),
  columns: { id: true, name: true, relatedEntityId: true },
  with: { childEntities: { columns: { id: true, name: true } } },
});
```

When the response needs computed/flattened fields, add a small pure mapper alongside the DTO:

```typescript
// <% backend.src_dir %>/entity-name/entity-name.mapper.ts
export const toDetailsDto = (e): EntityNameDetailsResponseDto => ({
  id: e.id,
  name: e.name,
  relatedEntityId: e.relatedEntityId ?? undefined,
  relatedEntityName: e.relatedEntity?.name,
  childEntities: e.childEntities.map((c) => ({ id: c.id, name: c.name })),
});
```

<% sections.mapping %>
