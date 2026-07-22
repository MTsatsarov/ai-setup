---
name: frontend-components
description: Use when adding or styling UI with Material UI — importing components, the sx prop, the theme, and where MUI ends and your app components begin. Covers styling without inline styles.
---

# Skill: UI Components (Material UI)

## Key Concept
MUI is an **npm dependency**, not copy-in source. You import finished components from
`@mui/material` and style them through the theme and the `sx` prop — you do not own or edit the
component files.

```tsx
import { Button, TextField, Card, CardContent, Typography } from '@mui/material';
```

Import from the top-level `@mui/material` entry. Do not deep-import internal paths like
`@mui/material/internal/...` — they are not part of the public API and break between versions.

## The theme is the single source of style

Every visual token — colours, spacing, typography, breakpoints — comes from the theme created in
`apps/web/src/theme.ts` and applied once by `<ThemeProvider>` at the app root. Change the
look there, not at call sites.

```ts
// apps/web/src/theme.ts
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: { mode: 'light', primary: { main: '#1976d2' } },
});
```

Read theme values in components with the `sx` callback: `sx={{ color: 'primary.main', p: 2 }}`.

## `sx`, not `style`

Style with the **`sx` prop** (or `styled()` for reusable components), never inline `style=`. `sx`
resolves theme tokens, supports responsive breakpoints, and handles pseudo-selectors.

```tsx
// theme-aware spacing and colour, responsive padding
<Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.paper', color: 'text.secondary' }}>…</Box>
```

`p: 2` means two theme spacing units (16px by default) — not `2px`. Numbers are spacing multiples,
strings are raw CSS. Reach for `styled()` when the same styled element appears in several places.

## Two kinds of component

| Kind | Comes from | Rule |
|---|---|---|
| MUI component | `@mui/material` | imported; style via `sx`/theme, never fork it |
| App component | `apps/web/src/components` | yours; composes MUI parts, knows your domain |

Keep domain knowledge out of MUI usage — wrap it in an app component. A page should render
`<EntityNameCard>`, not a bare `<Card>` full of entity-specific markup.

## Buttons that navigate

MUI's `Button` renders a `<button>`. To make it navigate, hand it your router's link via
`component` — do not nest an `<a>` inside it.

```tsx
import { Link } from 'react-router-dom'; // or next/link
<Button component={Link} to="/entity-names/new" variant="contained">New</Button>
```

Use `variant="contained"` for primary actions, `"outlined"` for secondary, `"text"` for tertiary.

## Lists and tables

For a simple list, `List`/`ListItem` from `@mui/material` is enough. For sortable, paginated tabular
data, use **`@mui/x-data-grid`** (a separate install: `npm install @mui/x-data-grid`) rather than
hand-building a table — but only when you actually need sorting/paging; a plain `Table` is lighter.

## Checklist
- [ ] Components imported from the top-level `@mui/material` entry
- [ ] Styling via `sx` / `styled()` and theme tokens — no inline `style=`
- [ ] Visual changes made in `theme.ts`, not per call site
- [ ] Domain logic lives in app components, not scattered across MUI parts
- [ ] Navigating buttons use `component={Link}`, not a nested `<a>`
