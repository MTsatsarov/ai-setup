## Arranging data

Use a fresh in-memory or throwaway `<% orm.context_class %>` per test — never a
shared static instance. Tests that share a context share change-tracker state,
and start failing in whatever order the runner happens to pick.

```csharp
internal static class TestDb
{
    public static <% orm.context_class %> Fresh()
    {
        var options = new DbContextOptionsBuilder<<% orm.context_class %>>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())   // unique per test
            .Options;
        return new <% orm.context_class %>(options);
    }
}
```

Seed only what the case needs, inline and visibly. A shared seed fixture makes
every test depend on rows it never mentions, so the reason a test passes stops
being readable from the test.

**Soft delete is a behaviour to test, not a detail to work around.** When a
query is supposed to exclude deleted rows, arrange one deleted row and assert it
is absent.
