import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum FilterOperator {
  Equals = 'Equals',
  NotEquals = 'NotEquals',
  Contains = 'Contains',
  StartsWith = 'StartsWith',
  GreaterThan = 'GreaterThan',
  GreaterThanOrEqual = 'GreaterThanOrEqual',
  LessThan = 'LessThan',
  LessThanOrEqual = 'LessThanOrEqual',
  In = 'In',
  IsNull = 'IsNull',
  IsNotNull = 'IsNotNull',
}

// One client-supplied filter. `field` must appear in the service's `filterable`
// allowlist or the request is rejected — this type is not a query language.
export class FilterDescriptorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  field: string;

  @ApiProperty({ enum: FilterOperator, default: FilterOperator.Equals })
  @IsEnum(FilterOperator)
  operator: FilterOperator = FilterOperator.Equals;

  // Parsed into the column's type. For `In`, a comma-separated list.
  // Ignored by `IsNull` / `IsNotNull`.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  value?: string;
}

export class SortDescriptorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  field: string;

  // NOT @Type(() => Boolean): that calls Boolean('false'), which is true, so a
  // client could never turn a descending sort back off.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  descending = false;
}

// Shared base every listing request extends.
export class BasePaginatedRequestDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 20;

  @ApiPropertyOptional({ type: [FilterDescriptorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterDescriptorDto)
  filters: FilterDescriptorDto[] = [];

  @ApiPropertyOptional({ type: [SortDescriptorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortDescriptorDto)
  sorters: SortDescriptorDto[] = [];

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
