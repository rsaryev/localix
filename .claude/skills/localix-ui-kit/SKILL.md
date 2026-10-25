---
name: localix-ui-kit
description:
  Draw Localix UI with the kit's primitives; read the catalog and the job table first, reuse before
  hand-rolling, and add a primitive the right way.
---

# Localix UI kit

Every surface, the Store and Settings included, is drawn with `@localixai/kit`. Before writing
markup for a heading, label, row, chip, notice, field or list:

1. Read the job table in `docs/internals/visual-system.md` ("Which primitive for which job"), then
   the catalog it comes from, `packages/kit/src/catalog/*.ts`: each module has `use` (the job) and
   `not` (what it must not be confused with).
2. Take the primitive. A native `<button>`, a hand-made `<label>`, an `h2` with a `text-sm`
   paragraph under it, a bordered `divide-y` card or a `rounded-full` span means the kit has the
   module and you have not looked. Import it by its door, `@localixai/kit/<id>`; never copy its
   classes.
3. If the kit lacks the job, check whether an existing primitive takes a new variant before adding a
   module. A variant or a new door reaches every surface and every mini app at once.
4. Tokens only: colours, radii, spacing and motion come from the theme
   (`docs/internals/visual-system.md`). A size is a rung (`size="sm"`), never a height in
   `className`.

## Adding a primitive

Follow `packages/kit/AGENTS.md`: the file in the folder for its job, the door `src/entries/<id>.ts`
(an explicit re-export list), the catalog entry with `use` and `not`, and a test next to the file,
written first and seen failing. Then add the job to the table in `docs/internals/visual-system.md`,
the door to `docs/extending/ui-kit.md`, and run `bun test packages/kit/src/catalog/catalog.test.ts`
and the token guards in `scripts/`.

Renaming or removing a door breaks installed mini apps that import it: update its catalog entry, its
callers and the docs in the same change.
