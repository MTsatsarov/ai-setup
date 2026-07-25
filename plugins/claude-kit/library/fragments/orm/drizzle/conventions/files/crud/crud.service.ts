import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  SQL,
} from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  BasePaginatedRequestDto,
  FilterDescriptorDto,
  FilterOperator,
  PagedResult,
  SortDescriptorDto,
} from '../dto/base-paginated-request.dto';
import type { Database } from '../db/drizzle.module';

// Any pgTable carrying the columns this base relies on — all three come from the
// auditColumns spread every domain table uses.
export type CrudTable = PgTable & { id: PgColumn; isDeleted: PgColumn; createdAt: PgColumn };

/**
 * Soft-delete-aware CRUD, generic in the table, its key, and the four models a
 * feature exposes over it.
 *
 * The write methods return the id rather than the row: a row is a persistence
 * concern and returning one invites it into a response. A caller that needs the
 * saved record reads it back through the feature's own details method.
 */
export abstract class CrudService<
  TTable extends CrudTable,
  TId,
  TCreate,
  TUpdate extends { id: TId },
  TListRequest extends BasePaginatedRequestDto,
  TListItem,
> {
  protected abstract readonly table: TTable;

  /**
   * Columns a client may filter/sort on, keyed by the name the client sends.
   * Empty by default: a listing exposes no query surface until the feature opts
   * in, so adding a column never silently adds a filter.
   */
  protected readonly filterable: Record<string, PgColumn> = {};
  protected readonly sortable: Record<string, PgColumn> = {};

  constructor(protected readonly db: Database) {}

  // Drizzle's query-builder types are conditional on a *concrete* table, so
  // they cannot resolve against an unresolved generic. The cast is confined to
  // this accessor; every public signature below stays typed via $inferSelect /
  // $inferInsert, so callers lose nothing.
  private get t(): any {
    return this.table;
  }

  protected get notDeleted(): SQL | undefined {
    return eq(this.table.isDeleted, false);
  }

  /** Maps a selected row to the listing shape. */
  protected abstract toListItem(row: TTable['$inferSelect']): TListItem;

  /**
   * Typed filters the descriptor model cannot express — joins, computed
   * predicates, tenant scoping. Composes with the descriptors rather than
   * replacing them: both are ANDed together.
   */
  protected applyCustomFilters(request: TListRequest): SQL | undefined {
    void request;
    return undefined;
  }

  async getListing(request: TListRequest): Promise<PagedResult<TListItem>> {
    const where = and(
      this.notDeleted,
      this.applyCustomFilters(request),
      ...this.buildFilters(request.filters),
    );

    // Count the filtered set, not the page.
    const totals: { value: number }[] = await this.db
      .select({ value: count() })
      .from(this.t)
      .where(where);

    const rows: TTable['$inferSelect'][] = await this.db
      .select()
      .from(this.t)
      .where(where)
      .orderBy(...this.buildOrder(request.sorters))
      .limit(request.pageSize)
      .offset(request.skip);

    const total = totals[0]?.value ?? 0;

    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
      page: request.page,
      pageSize: request.pageSize,
      totalPages: request.pageSize > 0 ? Math.ceil(total / request.pageSize) : 0,
    };
  }

  async create(input: TCreate): Promise<TId> {
    // Same reason as `t`: the values() overload resolves against a concrete
    // table, so an unresolved generic model cannot satisfy it.
    const rows = (await this.db
      .insert(this.t)
      .values(input as Record<string, unknown>)
      .returning({ id: this.table.id })) as { id: TId }[];

    return rows[0].id;
  }

  /** The id travels on the model, so a caller cannot update one row while claiming another. */
  async update(input: TUpdate): Promise<TId> {
    const { id, ...data } = input;

    const rows = (await this.db
      .update(this.t)
      .set(data)
      .where(and(this.notDeleted, eq(this.table.id, id)))
      .returning({ id: this.table.id })) as { id: TId }[];

    if (!rows[0]) {
      throw new NotFoundException(`Not found: ${String(id)}`);
    }

    return rows[0].id;
  }

  /** Soft delete — sets isDeleted rather than removing the row. */
  async delete(id: TId): Promise<void> {
    const rows = (await this.db
      .update(this.t)
      .set({ isDeleted: true })
      .where(and(this.notDeleted, eq(this.table.id, id)))
      .returning({ id: this.table.id })) as { id: TId }[];

    if (!rows[0]) {
      throw new NotFoundException(`Not found: ${String(id)}`);
    }
  }

  /** Untracked read narrowed to one row — the starting point for a details read. */
  protected async findOne(id: TId): Promise<TTable['$inferSelect']> {
    const rows: TTable['$inferSelect'][] = await this.db
      .select()
      .from(this.t)
      .where(and(this.notDeleted, eq(this.table.id, id)))
      .limit(1);

    if (!rows[0]) {
      throw new NotFoundException(`Not found: ${String(id)}`);
    }

    return rows[0];
  }

  protected buildFilters(filters: FilterDescriptorDto[] = []): SQL[] {
    return filters.map((filter) => {
      const column = this.resolve(filter.field, this.filterable);

      switch (filter.operator) {
        case FilterOperator.IsNull:
          return isNull(column);
        case FilterOperator.IsNotNull:
          return isNotNull(column);
        case FilterOperator.Contains:
          return ilike(column, `%${escapeLike(this.text(filter))}%`);
        case FilterOperator.StartsWith:
          return ilike(column, `${escapeLike(this.text(filter))}%`);
        case FilterOperator.In: {
          const values = this.text(filter)
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
            .map((v) => coerce(v, column, filter.field));

          if (values.length === 0) {
            throw new BadRequestException(`Filter 'In' on '${filter.field}' has no values.`);
          }
          return inArray(column, values);
        }
        case FilterOperator.NotEquals:
          return ne(column, this.value(filter, column));
        case FilterOperator.GreaterThan:
          return gt(column, this.value(filter, column));
        case FilterOperator.GreaterThanOrEqual:
          return gte(column, this.value(filter, column));
        case FilterOperator.LessThan:
          return lt(column, this.value(filter, column));
        case FilterOperator.LessThanOrEqual:
          return lte(column, this.value(filter, column));
        default:
          return eq(column, this.value(filter, column));
      }
    });
  }

  /**
   * User sorters first, then createdAt descending when none were supplied, then
   * id as a final tiebreaker. That last clause is not decoration: without a total
   * order, two rows with equal sort keys can swap between pages and the client
   * sees one row twice while never seeing another.
   */
  protected buildOrder(sorters: SortDescriptorDto[] = []): SQL[] {
    const order = sorters.map((sorter) => {
      const column = this.resolve(sorter.field, this.sortable);
      return sorter.descending ? desc(column) : asc(column);
    });

    if (order.length === 0) {
      order.push(desc(this.table.createdAt));
    }

    order.push(asc(this.table.id));
    return order;
  }

  private resolve(field: string, allowed: Record<string, PgColumn>): PgColumn {
    const column = Object.prototype.hasOwnProperty.call(allowed, field)
      ? allowed[field]
      : undefined;

    if (!column) {
      throw new BadRequestException(
        `'${field}' is not queryable. Allowed: ${Object.keys(allowed).join(', ') || '(none)'}`,
      );
    }

    return column;
  }

  private text(filter: FilterDescriptorDto): string {
    if (filter.value === undefined || filter.value === null) {
      throw new BadRequestException(`Filter on '${filter.field}' requires a value.`);
    }
    return filter.value;
  }

  private value(filter: FilterDescriptorDto, column: PgColumn): unknown {
    return coerce(this.text(filter), column, filter.field);
  }
}

// Postgres treats % and _ as wildcards; a user searching for "50%" means the
// literal characters, so they are escaped rather than passed through.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function coerce(raw: string, column: PgColumn, field: string): unknown {
  switch (column.dataType) {
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new BadRequestException(`Cannot read '${raw}' as a number for filter '${field}'.`);
      }
      return n;
    }
    case 'bigint': {
      try {
        return BigInt(raw);
      } catch {
        throw new BadRequestException(`Cannot read '${raw}' as an integer for filter '${field}'.`);
      }
    }
    case 'boolean': {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new BadRequestException(`Cannot read '${raw}' as a boolean for filter '${field}'.`);
    }
    case 'date': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`Cannot read '${raw}' as a date for filter '${field}'.`);
      }
      return d;
    }
    default:
      return raw;
  }
}
