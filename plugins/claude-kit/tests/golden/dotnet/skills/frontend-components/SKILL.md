---
name: frontend-components
description: Use when adding PrimeNG components to an Angular standalone component — per-component imports, theming, and the table/form controls. Covers why there is no global module to register.
---

# Skill: UI Components (PrimeNG)

## Key Concept
PrimeNG components are imported **per standalone component**, in that component's `imports` array.
There is no global module registration — if a template uses `<p-button>`, that component must
import `ButtonModule` itself.

```ts
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';

@Component({
  selector: 'app-entity-name-list',
  imports: [ButtonModule, TableModule],
  template: `...`,
})
export class EntityNameListComponent {}
```

Import only what the template uses. There is no barrel import of the suite, and adding one would
defeat tree-shaking.

## Setup

PrimeNG needs a theme provider and the animations provider. Both live in `app.config.ts`:

```ts
// angular/src/app/app.config.ts
import { providePrimeNG } from 'primeng/config';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import Aura from '@primeuix/themes/aura';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideAnimationsAsync(),
    providePrimeNG({ theme: { preset: Aura } }),
  ],
};
```

`@angular/animations` is a peer dependency PrimeNG needs but the Angular CLI starter does not
install. It is added explicitly at scaffold time — if `npm install primeng` ever fails to resolve
on a fresh project, a missing `@angular/animations` is why.

## Common components

```html
<!-- Button: a directive-style component, self-closing -->
<p-button label="New" routerLink="/entity-names/new" />
<p-button type="submit" label="Save" [disabled]="form.invalid" />

<!-- Text input: a DIRECTIVE on a native input, not a wrapper element -->
<input pInputText id="name" formControlName="name" />

<!-- Table: value binding plus a body template -->
<p-table [value]="rows">
  <ng-template pTemplate="body" let-row>
    <tr><td>{{ row.name }}</td></tr>
  </ng-template>
</p-table>
```

Note the asymmetry: `p-button` is an element, `pInputText` is an **attribute directive** on a
native `<input>`. Writing `<p-inputText>` is a common mistake and renders nothing.

## Rules

**Import per component, never globally.** A missing import is a template compile error naming the
unknown element — read it literally, it is telling you which module to add.

**Style with the theme, not overrides.** Change the preset or its tokens in `providePrimeNG`
rather than fighting component CSS at call sites.

**Reactive forms integrate directly.** `formControlName` works on `pInputText` because it is a
directive on a native input; no adapter is needed.

**Prefer `p-table` over hand-rolled tables** once sorting, paging or selection appears — but a
plain `<ul>` is fine for a simple list, and lighter.

## Checklist
- [ ] Every PrimeNG component used in a template is in that component's `imports`
- [ ] `providePrimeNG` with a theme preset, and `provideAnimationsAsync()`, are in `app.config.ts`
- [ ] `pInputText` used as an attribute on `<input>`, not as an element
- [ ] No barrel import of the whole suite
- [ ] Theming done via the preset, not per-component CSS overrides
