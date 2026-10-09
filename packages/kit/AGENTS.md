# Changing the kit

`@localixai/kit` is the one set of primitives the workbench and every plugin view are drawn with. A
plugin takes each module from the running host, so a kit module has exactly one instance, and a
change here reaches every surface at once. The rules below exist because each of them was once
broken by a surface that built its own copy of something the kit already had.

## The kit sits below everything that uses it

The kit imports no app code (`@/…`), no app package and no plugin package;
`scripts/check-architecture.mjs` (`kitBoundaryProblem`) fails the build when it does. What a
primitive needs from the host arrives as a prop, a port, or a store the host writes — the way
`src/keyboard/chord-store.ts` carries resolved chords without knowing where they came from. A module
that cannot be written that way is bound to a host feature: it is lent by the app from
`apps/ui/src/app/kit/`, whose README states the admission rule, and it does not belong here.

## Adding a primitive: file, door, catalog entry, test

1. **The file** goes in the folder for its job (`src/controls/`, `src/overlays/`, `src/layout/`,
   `src/lists/`, `src/feedback/`, `src/content/`, `src/keyboard/`, `src/canvas/`); shared helpers go
   in `src/lib/`. New source files stay under 300 lines (`scripts/source-size-guard.test.ts`).
2. **The door**, `src/entries/<id>.ts`, is the component or helper’s public module: an explicit
   re-export list, never `export *`. The door is the contract — the plugin kit staging
   (`scripts/stage-plugin-kit.mjs`) reads its names, and an export nobody listed is not public.
3. **The catalog entry** goes in the `src/catalog/<category>.ts` for its category: the job it is for
   (`use`) and what it must not be confused with (`not`). A props list does not tell anyone which
   primitive a job needs, and the catalog is what the plugin authoring agent chooses from
   (`KIT.md`). `src/catalog/catalog.test.ts` pins the catalog to the doors in both directions: a
   door without an entry, an entry without a door, or an entry naming an export its door does not
   have fails.
4. **The test** sits next to the file. Use a DOM test (`*.dom.test.tsx`, the harness in
   `src/testing/`) only when interaction or accessibility needs rendered evidence; the shared
   control and overlay contracts in `src/testing/` are the ones to extend before writing a new
   assertion by hand.

Renaming or removing a door is a breaking change for every installed plugin that imports it: update
its catalog entry, its callers and `docs/extending/ui-kit.md` in the same change.

## Paint only with the theme's tokens

Colours, radii, spacing and motion come from `styles/` (`styles/tailwind-theme.css` defines the
tokens, `styles/index.css` is the cascade). Tailwind emits nothing for a class naming a token that
does not exist, so a misspelt token paints nothing and passes every other check;
`scripts/ui-token-existence-guard.test.ts` and `scripts/ui-token-drift-guard.test.ts` catch it. The
paint contract itself is [docs/internals/visual-system.md](../../docs/internals/visual-system.md).

## Checks

Follow the root development workflow and choose checks for the changed contract. The
[package README](README.md#checks) gives focused catalog and token examples. Run a component's
colocated tests when its behavior changes, using the shared DOM harness for interaction or
accessibility evidence. Documentation-only changes need documentation validation. Full suites, type
checks and repository gates belong to CI; run an individual gate only for a concrete question or an
explicit request.
