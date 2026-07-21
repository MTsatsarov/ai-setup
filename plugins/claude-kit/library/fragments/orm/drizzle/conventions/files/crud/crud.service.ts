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
