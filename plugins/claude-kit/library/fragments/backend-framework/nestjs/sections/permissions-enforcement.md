### Enforcing in NestJS

Roles are checked by a guard reading metadata set by a decorator:

```typescript
// <% backend.common_dir %>/auth/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// <% backend.common_dir %>/auth/roles.guard.ts
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
