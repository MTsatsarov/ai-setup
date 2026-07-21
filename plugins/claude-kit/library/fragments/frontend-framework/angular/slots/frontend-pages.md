---
name: frontend-pages
description: Use when adding a route or standalone component in Angular — route configuration, lazy loading, the async pipe, and control-flow syntax. Covers subscription management and what belongs in a component.
---

# Skill: Components and Routing (Angular)

## Key Concept
Components are **standalone**. There is no `NgModule` to declare them in — each component lists
its own `imports`, and routes load components directly.

## Routes

Every route lazy-loads its component with `loadComponent`, so a route's code is only fetched when
the user goes there:

```ts
// <% frontend.src_dir %>/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'entity-names' },
  {
    path: 'entity-names',
    loadComponent: () =>
      import('./entity-names/entity-name-list').then((m) => m.EntityNameListComponent),
  },
  {
    path: 'entity-names/new',
    loadComponent: () =>
      import('./entity-names/entity-name-form').then((m) => m.EntityNameFormComponent),
  },
];
```

Route paths carry no leading slash. `pathMatch: 'full'` on the empty path is required — without
it the redirect matches every route and the app never navigates anywhere else.

## A list component

```ts
// <% frontend.component_dir %>/entity-names/entity-name-list.ts
import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntityNameService } from './entity-name.service';

@Component({
  selector: 'app-entity-name-list',
  imports: [AsyncPipe, RouterLink],
  template: `
    <div class="flex justify-between">
      <h1>Entity names</h1>
      <a routerLink="/entity-names/new">New</a>
    </div>

    @if (page$ | async; as page) {
      <ul>
        @for (row of page.items; track row.id) {
          <li>{{ row.name }}</li>
        }
      </ul>
    }
  `,
})
export class EntityNameListComponent {
  private readonly service = inject(EntityNameService);
  protected readonly page$ = this.service.list();
}
```

## Rules

**Prefer the `async` pipe over `subscribe`.** It subscribes on render and unsubscribes on destroy
for you. A manual `subscribe()` in a component leaks unless you tear it down — if you genuinely
need one, use `takeUntilDestroyed()`.

**Import exactly what the template uses.** `imports` is the standalone equivalent of the old
module declarations: `AsyncPipe` for `| async`, `RouterLink` for `routerLink`, `ReactiveFormsModule`
for `formGroup`. A missing entry is a template error, not a silent no-op.

**Use the built-in control flow** — `@if`, `@for`, `@switch` — not the old `*ngIf` / `*ngFor`
directives. `@for` **requires** a `track` expression; use a stable id, never `$index`, or the DOM
is rebuilt on every change.

**Keep components thin.** No HTTP calls, no business rules — inject a service. A component decides
what to render, not what the data means.

**`protected` for template-only members.** Anything the template touches must not be `private`;
`protected` keeps it out of the public API while staying template-accessible.

## Checklist
- [ ] Component is standalone and lists its own `imports`
- [ ] Route uses `loadComponent` for lazy loading
- [ ] Empty-path redirect has `pathMatch: 'full'`
- [ ] Observables consumed with `| async`, not a manual `subscribe`
- [ ] `@for` has a stable `track`
- [ ] No `HttpClient` and no business logic in the component
