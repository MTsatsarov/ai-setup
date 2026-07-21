---
name: frontend-api-client
description: Use when calling the backend from Next.js — the typed fetch wrapper, per-resource functions, error handling and caching. Covers where API calls belong and how responses are typed.
---

# Skill: API Client (Next.js)

## Key Concept
Components never call `fetch` directly. One wrapper in `apps/web/src/lib/api.ts` owns the
base URL, headers, error shape and cache policy; per-resource functions sit on top of it and give
each endpoint a name and a return type.

The base URL comes from `NEXT_PUBLIC_API_URL` — public because the browser needs it in Client
Components. Never put a secret in a `NEXT_PUBLIC_` variable.

## The wrapper

```ts
// apps/web/src/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3311';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: (path: string) => request<void>(path, { method: 'DELETE' }),
};
```

`res.status === 204` is not a detail to drop — a `DELETE` returns no body, and calling
`res.json()` on it throws a parse error that looks nothing like the real cause.

## Per-resource functions

Give every endpoint a named function with an explicit return type. Components import these,
never `api.get` with a raw path — that is what keeps the URL in one place when it changes.

```ts
// apps/web/src/lib/api.ts (continued)
export type Paged<T> = { items: T[]; total: number };
export type EntityName = { id: string; name: string };

export const listEntityNames = (skip = 0, take = 20) =>
  api.get<Paged<EntityName>>(`/entity-names?skip=${skip}&take=${take}`);

export const createEntityName = (input: { name: string }) =>
  api.post<EntityName>('/entity-names', input);
```

Types mirror the backend's response DTOs. They are hand-written here — when a backend DTO
changes, this file changes with it, and TypeScript will not warn you. Check both sides.

## Caching

`cache: 'no-store'` is the default above because CRUD data is rarely safe to cache. Override
deliberately, per call, when data is genuinely static:

| Need | Pass |
|---|---|
| Always fresh (default) | `cache: 'no-store'` |
| Cache until revalidated | `next: { revalidate: 60 }` |
| Invalidate on write | `revalidatePath('/entity-names')` in a Server Action |

After a mutation from a Client Component, call `router.refresh()` — it re-runs the Server
Component and pulls fresh data without a full reload.

## Rules

- **Server Components call these directly.** No hook, no `useEffect`, no loading state — `await`
  the function in the component body.
- **Client Components call them in an event handler**, never during render.
- **Do not catch `ApiError` just to log it.** Let it reach an `error.tsx` boundary, or catch it
  where you can actually show the user something.

## Checklist
- [ ] Every endpoint has a named function with an explicit return type
- [ ] No `fetch` outside `lib/api.ts`
- [ ] 204 responses handled without parsing a body
- [ ] Base URL read from `NEXT_PUBLIC_API_URL`, never hardcoded at a call site
- [ ] No secret in any `NEXT_PUBLIC_` variable
