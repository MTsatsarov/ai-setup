---
name: frontend-api-client
description: Use when calling the backend from Angular — the injectable HttpClient service, typed models, HttpParams and error handling. Covers why components never touch HttpClient directly.
---

# Skill: API Client (Angular)

## Key Concept
Every resource gets one `@Injectable({ providedIn: 'root' })` service that owns its URLs and
returns typed `Observable`s. Components inject the service; they never inject `HttpClient`.

`providedIn: 'root'` means no provider registration anywhere — the service is tree-shakeable and
a singleton.

## Models

Interfaces mirroring the backend's DTOs, beside the service that returns them:

```ts
// <% frontend.component_dir %>/entity-names/entity-name.models.ts
export interface EntityName {
  id: string;
  name: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}
```

## The service

```ts
// <% frontend.component_dir %>/entity-names/entity-name.service.ts
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EntityName, Paged } from './entity-name.models';

@Injectable({ providedIn: 'root' })
export class EntityNameService {
  private readonly http = inject(HttpClient);
  private readonly base = '/entity-names';

  list(skip = 0, take = 20): Observable<Paged<EntityName>> {
    const params = new HttpParams().set('skip', skip).set('take', take);
    return this.http.get<Paged<EntityName>>(this.base, { params });
  }

  get(id: string): Observable<EntityName> {
    return this.http.get<EntityName>(`${this.base}/${id}`);
  }

  create(input: { name: string }): Observable<EntityName> {
    return this.http.post<EntityName>(this.base, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
```

## Rules

**Use `inject()`, not constructor parameters.** It is the current idiom, works in field
initialisers, and avoids the parameter-decorator ceremony.

**Build query strings with `HttpParams`,** never string concatenation — it encodes values for you.
Note `HttpParams` is immutable: `.set()` returns a new instance, so chain it or reassign.

**Type every method's return.** `Observable<Paged<EntityName>>`, not `Observable<any>`. The
generic on `http.get<T>()` is a cast, not a check — it does not validate the response, so keep
the interfaces honest against the backend.

**Return the Observable; do not subscribe in the service.** Subscription is the caller's decision,
because only the caller knows when to stop.

## Wiring

`provideHttpClient()` must be in `appConfig.providers` — without it, injecting `HttpClient` fails
at runtime with a null-injector error:

```ts
// <% frontend.src_dir %>/app/app.config.ts
providers: [provideRouter(routes), provideHttpClient()]
```

The backend base URL belongs in `environment.ts`, or behind a dev-server proxy so relative paths
like `/entity-names` work unchanged in both dev and production.

## Checklist
- [ ] One `@Injectable({ providedIn: 'root' })` service per resource
- [ ] Dependencies obtained with `inject()`
- [ ] Every method returns a typed `Observable<T>`
- [ ] Query strings built with `HttpParams`
- [ ] No `subscribe` inside the service
- [ ] `provideHttpClient()` present in `app.config.ts`
