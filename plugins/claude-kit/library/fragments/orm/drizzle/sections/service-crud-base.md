## Reusable CRUD base

Put shared CRUD plumbing in `<% backend.common_dir %>/crud/`. The base service centralizes
soft-delete-aware Drizzle access; the base controller centralizes route shape and Swagger docs.

```typescript
// <% backend.common_dir %>/crud/crud.service.ts
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
