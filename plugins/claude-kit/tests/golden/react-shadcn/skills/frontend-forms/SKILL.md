---
name: frontend-forms
description: Use when building a form in the React (Vite) SPA — react-hook-form with a zod schema, validation, submission and error handling. Covers the one-schema-one-type rule.
---

# Skill: Forms (React + Vite)

## Key Concept
A form uses **react-hook-form** for state and **zod** for the schema, wired together by
`zodResolver`, so the validation rules and the TypeScript type come from one source.

```
npm install react-hook-form zod @hookform/resolvers
```

## The pattern

```tsx
// apps/web/src/routes/new-entity.tsx
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createEntityName } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
});

type FormValues = z.infer<typeof schema>;

export default function NewEntityPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      await createEntityName(values);
      navigate('/entity-names');
    } catch {
      setError('root', { message: 'Could not save. Try again.' });
    }
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">New entity name</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register('name')} aria-invalid={!!errors.name} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </main>
  );
}
```

## Rules

**Derive the type from the schema.** `z.infer<typeof schema>` — never declare the form's type
separately, or the two drift and the resolver silently stops matching.

**Mirror the backend's validation, do not replace it.** The zod schema gives fast feedback; the
server validates independently and is the authority. Keep the rules aligned — `max(200)` here should
match `[MaxLength(200)]` there.

**Use `isSubmitting`, never your own boolean.** react-hook-form already tracks it, and a hand-rolled
`useState` flag goes stale on the error path.

**Put submit failures on `root`.** `setError('root', …)` is for "the request failed"; field errors
come from the resolver. Do not overload a field's error with a server message unless the server
actually identified that field.

**Navigate after a successful write.** `useNavigate()` from `react-router-dom`, called in the success
branch — the list route's loader re-runs on navigation and shows the new row.

## Checklist
- [ ] One zod schema; the form type is `z.infer<typeof schema>`
- [ ] Schema rules match the backend's validation attributes
- [ ] Submit button disabled by `formState.isSubmitting`
- [ ] Failed submissions reported via `setError('root', …)`
- [ ] `useNavigate()` after a successful mutation
- [ ] Every input has a matching label tied by `htmlFor`/`id`
