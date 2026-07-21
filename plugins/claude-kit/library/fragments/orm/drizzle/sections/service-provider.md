## The Drizzle provider

Expose the typed `db` as an injectable so services depend on it via DI:

```typescript
// <% backend.common_dir %>/db/drizzle.module.ts
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
