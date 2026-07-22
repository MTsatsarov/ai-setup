---
name: frontend-pages
description: Use when adding or changing a route in the React (Vite) SPA — createBrowserRouter, route components, loaders, useLoaderData and navigation. Covers where data fetching belongs in a client-rendered app.
---

# Skill: Pages and Routing (React Router)

## Key Concept
Routes are declared in one place with `createBrowserRouter` and rendered by a single
`<RouterProvider>`. Each route points at a **route component** under `<% frontend.route_dir %>`; a
route's data is fetched by its **loader**, not by `useEffect` inside the component.

```tsx
// <% frontend.src_dir %>/App.tsx
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import EntitiesPage, { loader as entitiesLoader } from '@/routes/entities';
import NewEntityPage from '@/routes/new-entity';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/entity-names" replace /> },
  { path: '/entity-names', element: <EntitiesPage />, loader: entitiesLoader },
  { path: '/entity-names/new', element: <NewEntityPage /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
```

## Loaders fetch; components render

A loader runs **before** the route renders and its result is read with `useLoaderData`. There is no
loading state to manage in the component — React Router shows the previous screen until the loader
resolves.

```tsx
// <% frontend.route_dir %>/entities.tsx
import { Link, useLoaderData } from 'react-router-dom';
import { listEntityNames, type EntityName } from '@/lib/api';

export async function loader(): Promise<EntityName[]> {
  return listEntityNames();
}

export default function EntitiesPage() {
  const entities = useLoaderData() as EntityName[];

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Entity names</h1>
        <Link to="/entity-names/new" className="text-blue-600 underline">
          New
        </Link>
      </div>
      <ul className="mt-6 space-y-2">
        {entities.map((e) => (
          <li key={e.id} className="rounded border p-3">
            {e.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

No `useState`, no `useEffect`, no loading flag — the loader owns the fetch, `useLoaderData` reads it.

## There is no server

This is a client-rendered SPA. Everything runs in the browser: there are **no Server Components**,
no `"use client"` directive, and no `async` component functions. A component that needs data either
reads it from a loader or fetches it in an effect/event handler — never by being `async` itself
(React cannot render a Promise).

## Navigation

- `<Link to="...">` for anything a user clicks — client-side navigation, no full reload.
- `useNavigate()` for programmatic navigation (e.g. after a successful submit): `navigate('/entity-names')`.
- `<Navigate to="..." replace />` to redirect declaratively inside the route table.
- Read URL params with `useParams()`, the query string with `useSearchParams()`.

## Rules

- **Fetch a page's data in its loader,** not in `useEffect` — the loader is typed, cached and runs
  before render.
- **Import from `react-router-dom`** (`Link`, `useNavigate`, `useLoaderData`) — there is no
  `next/link` or `next/navigation` here.
- **`useLoaderData` is untyped** — assert the return type (`as EntityName[]`) to match the loader.

## Checklist
- [ ] Route added to the `createBrowserRouter` table with a `path` and `element`
- [ ] A page's data comes from a `loader`, read via `useLoaderData`
- [ ] No `async` component functions and no `"use client"` — this is a SPA
- [ ] Navigation uses `<Link to>` / `useNavigate`, imported from `react-router-dom`
