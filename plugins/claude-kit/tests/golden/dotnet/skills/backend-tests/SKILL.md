---
name: backend-tests
description: Use when writing or changing xUnit tests for the C# backend — test project layout, naming, arrange/act/assert shape, and what must be covered before a change is done.
---

# Skill: Backend Tests (xUnit)

## Key Concept

Tests live in `tests/DemoCRM.Tests` and mirror the folder layout of
`src/DemoCRM.Api`. One test class per class under test, named
`<ClassUnderTest>Tests`.

A test names the behaviour, not the mechanism:

```csharp
public class CustomerServiceTests
{
    [Fact]
    public async Task Create_PersistsCustomer_AndReturnsItsId()
    {
        // arrange
        await using var ctx = TestDb.Fresh();
        var sut = new CustomerService(ctx);

        // act
        var id = await sut.Create(new CreateCustomerRequest { Name = "Acme" });

        // assert
        var saved = await ctx.Customers.SingleAsync(c => c.Id == id);
        Assert.Equal("Acme", saved.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public async Task Create_RejectsAnEmptyName(string? name)
    {
        await using var ctx = TestDb.Fresh();
        var sut = new CustomerService(ctx);

        await Assert.ThrowsAsync<ValidationException>(
            () => sut.Create(new CreateCustomerRequest { Name = name! }));
    }
}
```

`[Fact]` for a single case; `[Theory]` + `[InlineData]` when the same assertion
holds over a table of inputs. A `[Theory]` with one `[InlineData]` is a `[Fact]`
wearing a costume.

## Arranging data

Use a fresh in-memory or throwaway `AppDbContext` per test — never a
shared static instance. Tests that share a context share change-tracker state,
and start failing in whatever order the runner happens to pick.

```csharp
internal static class TestDb
{
    public static AppDbContext Fresh()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())   // unique per test
            .Options;
        return new AppDbContext(options);
    }
}
```

Seed only what the case needs, inline and visibly. A shared seed fixture makes
every test depend on rows it never mentions, so the reason a test passes stops
being readable from the test.

**Soft delete is a behaviour to test, not a detail to work around.** When a
query is supposed to exclude deleted rows, arrange one deleted row and assert it
is absent.

## What must be covered

For every behaviour the change adds or alters:

- the happy path, asserting the **returned value or the persisted state**
- each rejection the code can produce — invalid input, not found, forbidden
- the boundary: empty collection, zero, maximum length
- the soft-delete or filtering rule, where the query has one

## Rules

- **Assert on outcomes, not on interactions.** `Assert.Equal(expected, actual)`
  over the returned value or the row in the database. Verifying that a mock was
  called asserts how the code is written, and breaks on every refactor.
- **Never `Skip` a test to get past a failure.** A skipped test reports success
  forever. If it cannot pass, that is a finding.
- **Never edit production code to make a test pass.** If the code is wrong, say
  so — that is the most valuable thing a test pass can produce.
- **A test that cannot fail is worse than no test.** Before finishing, confirm
  each new test fails when the behaviour it covers is broken.
- One behaviour per test. A test asserting four things reports one failure and
  hides three.

## Checklist

- [ ] Test class mirrors the class under test, in `tests/DemoCRM.Tests`
- [ ] Happy path asserts returned value or persisted state
- [ ] Every rejection path has a case
- [ ] Boundary and empty cases covered
- [ ] No `Skip`, no weakened assertion, no production code changed
- [ ] Each new test observed to fail when the behaviour is broken
- [ ] `.claude/scripts/verify.sh tests` reports `VERDICT: PASS`
