---
name: frontend-api-client
description: Use when calling the backend from a React (Vite) SPA — the typed fetch wrapper, per-resource functions and error handling. Covers where API calls belong and how the base URL is configured.
---

# Skill: API Client (React + Vite)

## Key Concept
Components never call `fetch` directly. One wrapper in `apps/web/src/lib/api.ts` owns the
base URL, headers and error shape; per-resource functions sit on top and give each endpoint a name
and a return type.

The base URL comes from `import.meta.env.VITE_API_URL`. Vite only exposes env vars **prefixed with
`VITE_`** to client code — that prefix is deliberate, since everything here ships to the browser.
Never put a secret in a `VITE_` variable.

## The wrapper

```ts
// apps/web/src/lib/api.ts
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3311';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
```

**Declare the `status` field explicitly** — do not write `constructor(readonly status: number, …)`.
The Vite tsconfig enables `erasableSyntaxOnly`, which forbids TypeScript parameter properties (they
emit runtime code). The same rule rules out `enum` and `namespace`; reach for a `const` object with
`as const` instead of an enum.

`res.status === 204` is not a detail to drop — a `DELETE` returns no body, and calling `res.json()`
on it throws a parse error that looks nothing like the real cause.

## Per-resource functions

Give every endpoint a named function with an explicit return type. Components import these, never a
raw path — that is what keeps the URL in one place when it changes.

```ts
// apps/web/src/lib/api.ts (continued)
export interface EntityName {
  id: string;
  name: string;
}

export const listEntityNames = () => request<EntityName[]>('/entity-names');
export const getEntityName = (id: string) => request<EntityName>(`/entity-names/${id}`);
export const createEntityName = (body: { name: string }) =>
  request<EntityName>('/entity-names', { method: 'POST', body: JSON.stringify(body) });
```

Types mirror the backend's response DTOs. They are hand-written here — when a backend DTO changes,
this file changes with it, and TypeScript will not warn you. Check both sides.

## Where calls belong

- **A route loader** (`createBrowserRouter`) is the idiomatic place to fetch a page's data — the
  component then reads it with `useLoaderData`, no `useEffect` and no loading flag of your own.
- **An event handler** for writes (submit, delete) — call the function, then navigate.
- **Never during render.** Fetching in the component body without a loader re-fires on every render.

## Rules

- **No `fetch` outside `lib/api.ts`.** Every call goes through a named function.
- **Do not swallow `ApiError` just to log it.** Let it reach a React Router `errorElement`, or catch
  it where you can show the user something.
- **Read the base URL from `import.meta.env.VITE_API_URL`,** never hardcoded at a call site.

## Checklist
- [ ] Every endpoint has a named function with an explicit return type
- [ ] No `fetch` outside `lib/api.ts`
- [ ] `ApiError` declares its field explicitly (no parameter property — `erasableSyntaxOnly`)
- [ ] 204 responses handled without parsing a body
- [ ] Base URL read from `import.meta.env.VITE_API_URL`
- [ ] No secret in any `VITE_` variable
