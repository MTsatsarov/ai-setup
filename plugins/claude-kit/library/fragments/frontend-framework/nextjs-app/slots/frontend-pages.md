---
name: frontend-pages
description: Use when adding or changing a Next.js App Router route — page.tsx, layout.tsx, loading and error boundaries, and the Server vs Client Component decision. Covers file-system routing and where data fetching belongs.
---

# Skill: Pages and Routing (Next.js App Router)

## Key Concept
A route is a **folder** under `<% frontend.route_dir %>`. The folder name is the URL segment; the
files inside it decide what renders.

| File | Role |
|---|---|
| `page.tsx` | the route itself — required for the URL to exist |
| `layout.tsx` | wraps this route and everything nested under it; persists across navigation |
| `loading.tsx` | shown while the page's data resolves |
| `error.tsx` | catches errors thrown in this subtree (must be a Client Component) |
| `not-found.tsx` | rendered by `notFound()` |

```
<% frontend.route_dir %>/
  entity-names/
    page.tsx              → /entity-names
    loading.tsx
    new/
      page.tsx            → /entity-names/new
    [id]/
      page.tsx            → /entity-names/:id
```

## Server Components are the default

Every component is a Server Component unless it says otherwise. That is the important default:
it runs on the server, ships no JavaScript to the browser, and can `await` data directly.

```tsx
// <% frontend.route_dir %>/entity-names/page.tsx
import Link from 'next/link';
import { listEntityNames } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';

export default async function EntityNamesPage() {
  const { items, total } = await listEntityNames();

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Entity names ({total})</h1>
        <Link href="/entity-names/new" className={buttonVariants()}>
          New
        </Link>
      </div>

      <ul className="mt-6 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded border p-3">
            {item.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

No `useEffect`, no `useState`, no loading flag. The component is `async` and awaits the data.

## When to add `"use client"`

Add it **only** when the component needs one of:

- `useState` / `useReducer`
- `useEffect` or any lifecycle
- an event handler (`onClick`, `onChange`, `onSubmit`)
- a browser API (`window`, `localStorage`)
- a hook from a client library (`useForm`, `useRouter` from `next/navigation`)

If none of those apply, leave it out. `"use client"` is not boilerplate — it opts the component
*and everything it imports* into the client bundle.

**Push it down, not up.** When one interactive button sits in an otherwise static page, make the
button a Client Component and leave the page a Server Component. Marking the page `"use client"`
to satisfy the button ships the whole subtree to the browser for no reason.

## Dynamic segments

`params` and `searchParams` are **Promises** and must be awaited:

```tsx
// <% frontend.route_dir %>/entity-names/[id]/page.tsx
export default async function EntityNameDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entity = await getEntityName(id);
  return <main className="p-8">{entity.name}</main>;
}
```

Forgetting the `await` yields a Promise where a string was expected — a type error that reads
confusingly if you are expecting the older synchronous API.

## Navigation

- `<Link href="...">` for anything a user clicks — it prefetches and avoids a full reload
- `redirect('/path')` from a Server Component or Server Action
- `useRouter()` from `next/navigation` (**not** `next/router`) in Client Components
- `router.refresh()` after a mutation, to re-run Server Components with fresh data

## Checklist
- [ ] Route is a folder with `page.tsx`; the folder name is the URL segment
- [ ] Data is fetched by `await` in a Server Component, not in `useEffect`
- [ ] `"use client"` appears only where state, effects, handlers or browser APIs are used
- [ ] `params` / `searchParams` are awaited
- [ ] Navigation uses `<Link>`; `useRouter` is imported from `next/navigation`
- [ ] Long-running routes have a `loading.tsx`; fallible ones an `error.tsx`
