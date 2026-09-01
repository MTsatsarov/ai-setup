---
name: backend-tests
description: Use when writing or changing Jest tests for the NestJS API — spec layout, testing-module setup, arrange/act/assert shape, and what must be covered before a change is done.
---

# Skill: Backend Tests (Jest)

## Key Concept

Unit specs sit next to the code as `*.spec.ts`; end-to-end specs live in
`apps/api/test`. Build the module under test with
`Test.createTestingModule`, overriding only the providers the case actually
needs — a fixture that stubs everything tests nothing.

```ts
describe('CustomerService', () => {
  let service: CustomerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CustomerService, { provide: DB, useValue: testDb() }],
    }).compile();

    service = module.get(CustomerService);
  });

  it('persists the customer and returns its id', async () => {
    const id = await service.create({ name: 'Acme' });

    const saved = await testDb().query.customers.findFirst({
      where: (c, { eq }) => eq(c.id, id),
    });
    expect(saved?.name).toBe('Acme');
  });

  it.each([[''], [null]])('rejects an empty name (%p)', async (name) => {
    await expect(service.create({ name: name as string })).rejects.toThrow(BadRequestException);
  });
});
```

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

## What must be covered

For every behaviour the change adds or alters:

- the happy path, asserting the **returned value or the persisted state**
- each rejection the code can produce — invalid input, not found, forbidden
- the boundary: empty collection, zero, maximum length
- the soft-delete or filtering rule, where the query has one

## Rules

- **Assert on outcomes, not on interactions.** Assert the returned value or the
  row in the database. `expect(spy).toHaveBeenCalled()` asserts how the code is
  written, and breaks on every refactor.
- **Never `.skip` or `xit` a failing test.** A skipped test reports success
  forever. If it cannot pass, that is a finding.
- **Never edit production code to make a test pass.** If the code is wrong, say
  so — that is the most valuable thing a test pass can produce.
- **A test that cannot fail is worse than no test.** Before finishing, confirm
  each new test fails when the behaviour it covers is broken.
- One behaviour per `it`. A spec asserting four things reports one failure and
  hides three.

## Checklist

- [ ] Spec sits beside the unit under test, or in `apps/api/test` for e2e
- [ ] Testing module overrides only what the case needs
- [ ] Happy path asserts returned value or persisted state
- [ ] Every rejection path has a case
- [ ] Boundary and empty cases covered
- [ ] No `.skip`, no weakened assertion, no production code changed
- [ ] Each new test observed to fail when the behaviour is broken
- [ ] `.claude/scripts/verify.sh tests` reports `VERDICT: PASS`
