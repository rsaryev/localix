/**
 * The whole set of colocated `*.surface` declarations, as ONE module.
 *
 * This file exists to be `import()`ed, never statically imported. Splitting the
 * glob out here is what lets `discover.ts` stage surface discovery off the
 * startup path (see its docblock) while still paying exactly one request for it:
 * a lazy `import.meta.glob` would instead emit ~80 chunks and force Rolldown to
 * split every module they share with the shell into further shared chunks,
 * trading startup bytes for startup requests.
 *
 * The glob is EAGER inside this module on purpose — this module is already the
 * lazy boundary, and eagerness here is what keeps the declarations in one chunk
 * and their registration order equal to the glob's stable path order.
 *
 * The absolute pattern is resolved against the Vite root (apps/ui). Adding a
 * surface never requires editing this file. The kit's primitives declare their
 * own surfaces (a tab panel, an autocomplete list) and live outside that root,
 * so the kit's source is a second pattern: with the app's alone, those
 * declarations silently stopped registering when the primitives moved.
 */
export const uiSurfaceModules: Record<string, unknown> = import.meta.glob(
  ['/src/**/*.surface.{ts,tsx}', '../../../../../packages/kit/src/**/*.surface.{ts,tsx}'],
  { eager: true },
)
