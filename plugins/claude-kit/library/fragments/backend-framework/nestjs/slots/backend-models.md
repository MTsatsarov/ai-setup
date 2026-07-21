---
name: backend-models
description: Use when creating or modifying request/response DTOs in a feature's dto folder. Covers class-validator/class-transformer decorators, the PaginationQueryDto base, and response shaping via a partial select or a mapper.
---

# Skill: DTOs Pattern

## Overview
DTOs live in the `dto/` folder within each feature (`<% backend.src_dir %>/<feature>/dto/`). Request DTOs are validated by class-validator (via the global `ValidationPipe`) and transformed by class-transformer. Responses are shaped either by a partial `select` or a small mapper — never by returning raw table rows.

## Roles
- **Create/Update DTOs** — validated input (DTO → persisted data). Decorate every field.
- **Response DTOs** — the public shape returned to clients (record → DTO). Expose via `@ApiProperty` for Swagger; keep audit/soft-delete internals out.
- **Pagination DTO** — a shared base every list query extends.

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
import { CreateEntityNameDto } from './create-entity-name.dto';

// All fields optional; validation decorators are inherited.
export class UpdateEntityNameDto extends PartialType(CreateEntityNameDto) {}
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
// <% backend.common_dir %>/dto/pagination-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip = 0;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take = 20;
}
```

```typescript
// <% backend.src_dir %>/entity-name/dto/entity-name-pagination.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class EntityNamePaginationDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;
}
```

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
