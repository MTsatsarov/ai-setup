### Enforcing in ASP.NET Core

Apply `[Authorize]` at the controller and narrow per action. An action with no attribute inherits
the controller's policy, so put the restrictive default on the class:

```csharp
[ApiController]
[Route("entity-names")]
[Authorize(Roles = Roles.User)]
public class EntityNamesController(IEntityNameService service) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<EntityNameListItem>> List([FromQuery] EntityNameQuery query, CancellationToken ct) =>
        service.ListAsync(query, ct);

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = Roles.Admin)]   // narrower than the controller default
    public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
    {
        await service.RemoveAsync(id, ct);
        return NoContent();
    }
}
```

Register the fallback so a controller that forgets `[Authorize]` is still closed:

```csharp
// Program.cs
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
```

Endpoints that must stay open are then explicit with `[AllowAnonymous]` — a deny-by-default
posture, so a missing attribute fails closed rather than open.
