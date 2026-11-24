# 0010: Component folders and CSS Modules

Each web-app component lives in its own folder with a CSS Module beside it, and TypeScript knows every module's class names.

- Status: accepted
- Date: 2026-11-24

## Context

M1 started with flat `ui/`, `shell/` and `apps/` folders and global, BEM-style class names (`pg-window__title-bar`). The folders got long and a class name could be used anywhere without anyone noticing. The author wants one folder per component. CSS Modules come with Vite, so they need no new dependency. But Vite types a module as an index signature, which this repo's strict `tsconfig` (`noPropertyAccessFromIndexSignature`, `noUncheckedIndexedAccess`) turns into `styles['titleBar']` with no check that the class exists.

## Decision

- Every component is a folder named after it: `button/button.tsx`, `button/button.module.css`, `button/button.test.tsx`. Helpers that belong to one component sit in its folder (`taskbar/task-buttons.ts`).
- This holds in `ui/`, `shell/` and `apps/`. An app's files sit one folder deeper: `apps/<app>/<component>/`.
- Styles are CSS Modules with camelCase class names. The only global stylesheet is `ui/tokens.css`: tokens, font faces and base element rules.
- `ui/classes/classes.ts` joins classes conditionally, so `classList` isn't used.
- `scripts/css-module-types.mjs` writes a declaration beside each module (`button.module.d.css.ts`, via `allowArbitraryExtensions`) listing its exact class names. The declarations are git-ignored and regenerated before every `typecheck`, `dev` and `build`.
- Elements found from outside their component use a `data-` attribute, never a class (`data-pigeon-menu-button`).
- `@pigeon/core` and `app/` stay flat: they hold no components.

## Consequences

A typo in a class name, or a class with no rule, is a type error. Class names can't leak between components. Import paths are longer (`../../ui/button/button.tsx`) because there are no barrel files. A fresh clone shows type errors in the editor until `mise run setup` or a typecheck has written the declarations.
