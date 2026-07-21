---
name: frontend-components
description: Use when adding or styling UI with shadcn/ui — installing primitives, the cn() helper, variants, and the boundary between copied primitives and app components. Covers why these files are editable source.
---

# Skill: UI Components (shadcn/ui)

## Key Concept
shadcn is **not a dependency**. `npx shadcn@latest add button` copies a real `.tsx` file into
`apps/web/src/components/ui`, and from that moment it is your source — commit it, read it, edit it.

That is the whole idea, and it changes the rules: there is no upstream version to upgrade and no
prop API to work around. If a primitive is wrong for this project, change the file.

## Adding a primitive

```bash
npx shadcn@latest add <component>
# e.g. npx shadcn@latest add button input label dialog
```

Add primitives as you need them. Do not pre-install the catalogue — every copied file is code you
now own and have to maintain.

## Two kinds of component

| Kind | Lives in | Rule |
|---|---|---|
| Primitive | `apps/web/src/components/ui` | copied by the CLI; edit freely, but keep it generic |
| App component | `apps/web/src/components` | yours; composes primitives, knows about your domain |

Keep domain knowledge out of the primitives. `Button` should not know what an entity name is —
that belongs in an app component that uses `Button`.

## Composition, not `asChild`

The current default preset (`base-nova`) is built on **Base UI, not Radix**, and its `Button` has
**no `asChild` prop**. To render a link that looks like a button, apply the variants to the link:

```tsx
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

<Link href="/entity-names/new" className={buttonVariants()}>
  New
</Link>
```

```tsx
// Variants take the same options as the Button props:
<Link href="/x" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Edit</Link>
```

Reaching for `asChild` out of habit is a type error, not a runtime surprise — but the message is
long and easy to misread, so recognise it: *"Property 'asChild' does not exist"* means compose
with `buttonVariants` instead.

## `cn()`

Every primitive uses `cn()` from `@/lib/utils` to merge class names. Use it whenever a class list
is conditional — plain template strings produce conflicting Tailwind classes where the loser is
decided by stylesheet order rather than by you.

```tsx
import { cn } from '@/lib/utils';

<div className={cn('rounded border p-3', isActive && 'border-primary', className)} />
```

Always accept and forward a `className` prop on an app component, merged last so a caller can
override.

## Styling

- Use the theme tokens the primitives use — `bg-background`, `text-muted-foreground`,
  `border-input` — not raw palette classes like `bg-gray-100`. Tokens follow the theme; raw
  colours do not.
- Change the theme in the CSS variables in `globals.css`, not by overriding colours at call sites.

## Checklist
- [ ] Primitive added with the CLI, not hand-written
- [ ] Copied primitives are committed as project source
- [ ] Domain logic lives in app components, not in primitives
- [ ] Links styled as buttons use `buttonVariants()`, not `asChild`
- [ ] Conditional classes go through `cn()`
- [ ] Colours come from theme tokens
