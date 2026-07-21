---
name: backend-permissions
description: Use when adding a feature that requires authorization. Covers role constants, deny-by-default configuration, where to enforce role checks versus ownership checks, and the bypasses to avoid.
---

# Skill: Role-Based Authorization

## Key Concept
Roles answer **"may this kind of user do this kind of thing"**. They do not answer
**"may this user touch this row"**. The first is declarative and belongs at the endpoint; the
second is a domain rule and belongs in the service, after the entity is loaded.

Conflating them is the most common authorization bug: an endpoint correctly restricted to
`Manager` that still lets any manager edit any other team's records.

## Role constants

One file, referenced everywhere. Never type a role as a string literal at a call site — a typo in
`"Amin"` compiles, deploys, and silently denies (or worse, a typo in a *negative* check silently allows).

```csharp
// apps/api/src/common/Authorization/Roles.cs
public static class Roles
{
    public const string Admin = "Admin";
    public const string Manager = "Manager";
    public const string User = "User";
}
```

### Enforcing in NestJS

Roles are checked by a guard reading metadata set by a decorator:

```typescript
// apps/api/src/common/auth/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// apps/api/src/common/auth/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    return required.some((role) => user?.roles?.includes(role));
  }
}
```

Register it globally so endpoints are closed by default, and open them explicitly:

```typescript
// app.module.ts
providers: [{ provide: APP_GUARD, useClass: RolesGuard }]
```

```typescript
@Controller('entity-names')
@Roles(Role.User)
export class EntityNameController {
  @Delete(':id')
  @Roles(Role.Admin)      // narrower than the controller default
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

Note `getAllAndOverride` takes the handler's roles when present and falls back to the class —
that is what makes the per-route override work.

## Ownership checks belong in the service

```csharp
public async Task<EntityNameDetails> GetAsync(Guid id, CancellationToken ct = default)
{
    var entity = await Query.FirstOrDefaultAsync(e => e.Id == id, ct)
        ?? throw new KeyNotFoundException($"Not found: {id}");

    // Role said "managers may read entities". This says "and only their own".
    if (!currentUser.IsInRole(Roles.Admin) && entity.OwnerId != currentUser.Id)
    {
        throw new UnauthorizedAccessException();
    }

    return Mapper.Map<EntityNameDetails>(entity);
}
```

Note it throws **after** loading. Returning 404 rather than 403 for a record the caller may not see
is a deliberate choice — 403 confirms the record exists, which is itself a leak. Pick one policy and
apply it consistently.

## Checklist
- [ ] Every new endpoint has an explicit authorization decision — inherited, narrowed, or `[AllowAnonymous]`
- [ ] A fallback policy requires an authenticated user, so a forgotten attribute fails closed
- [ ] Roles are referenced via `Roles.*` constants, never string literals
- [ ] Where ownership matters, the service checks it after loading the entity
- [ ] List endpoints filter by ownership in the query — do not load everything and filter in memory
- [ ] The 404-vs-403 policy for unauthorized records is consistent across the codebase
