## Arranging data

Use a fresh schema or a transaction rolled back per test — never a shared
connection with leftover rows. Tests that share state start failing in whatever
order the runner happens to pick.

```ts
function testDb() {
  // one throwaway database per suite; truncate between cases
  return drizzle(pool, { schema });
}

beforeEach(async () => {
  await testDb().delete(schema.customers);
});
```

Seed only what the case needs, inline and visibly. A shared seed fixture makes
every test depend on rows it never mentions, so the reason a test passes stops
being readable from the test.

**Soft delete is a behaviour to test, not a detail to work around.** When a
query is supposed to exclude deleted rows, insert one with the deleted flag set
and assert it is absent from the result.
