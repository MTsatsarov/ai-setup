---
name: frontend-forms
description: Use when building a form in Angular — reactive forms with FormBuilder, validators, typed controls, submission and error display. Covers why reactive forms rather than template-driven.
---

# Skill: Forms (Angular)

## Key Concept
Forms are **reactive**, built with `FormBuilder` — the shape and its validation live in TypeScript,
where they can be typed and tested. Template-driven forms (`ngModel`) are not used in this project.

`fb.nonNullable.group(...)` is the default: controls keep their declared type instead of widening
to `T | null`, so `getRawValue()` returns exactly the shape the API expects.

## The pattern

```ts
// <% frontend.component_dir %>/entity-names/entity-name-form.ts
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EntityNameService } from './entity-name.service';
<% if ui-kit.ng_form_import_lines %><% ui-kit.ng_form_import_lines %>
<% end %>
@Component({
  selector: 'app-entity-name-form',
  imports: [ReactiveFormsModule<% if ui-kit.ng_form_imports %>, <% ui-kit.ng_form_imports %><% end %>],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
<% sections.ui %>
      <% ui-kit.ng_submit %>
    </form>
  `,
})
export class EntityNameFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(EntityNameService);
  private readonly router = inject(Router);

  protected saving = false;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving = true;
    this.service.create(this.form.getRawValue()).subscribe({
      next: () => this.router.navigate(['/entity-names']),
      error: () => (this.saving = false),
    });
  }
}
```

## Rules

**Import `ReactiveFormsModule`** in the component's `imports`, or `[formGroup]` fails to bind.

**Guard `submit()` with `markAllAsTouched()`.** A user who clicks Save without touching anything
sees nothing otherwise — the controls are invalid but untouched, so no error renders.

**Show errors only once touched.** `form.controls.name.touched && form.controls.name.invalid` —
validating on first render shouts at the user before they have typed.

**Mirror the backend's validation, do not replace it.** `Validators.maxLength(200)` should match
the server's `[MaxLength(200)]`. The server is the authority; this is fast feedback.

**Reset the saving flag on error.** In the `error` callback — not in a `finally`-style block that
does not exist on `subscribe`. Forgetting it leaves the button disabled forever after one failure.

**Access controls through `form.controls.x`,** which is typed, rather than `form.get('x')`, which
returns `AbstractControl | null` and loses the type.

## Checklist
- [ ] `ReactiveFormsModule` in the component's `imports`
- [ ] Built with `fb.nonNullable.group(...)`
- [ ] `submit()` calls `markAllAsTouched()` when invalid and returns early
- [ ] Errors shown only after `touched`
- [ ] Validators match the backend's rules
- [ ] Saving flag cleared in the `error` callback
- [ ] Every input has a `<label for>` matching its `id`
