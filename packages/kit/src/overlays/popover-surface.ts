/**
 * The RAISED surface — the material every popover, menu, dropdown, tooltip and floating toolbar is
 * cut from (dialogs and sheets take the same ground and edge from `modalSurface`, with a deeper
 * shadow). One recipe, docs/internals/visual-system.md, "Surfaces over the window":
 *
 *  - the raised ground `--popover`: the window's neutral lifted one step, opaque, never blurred;
 *  - ONE hairline, `border-border`. The recipe owns the edge: a caller adds geometry, never a
 *    second edge (scripts/raised-surface-guard.test.ts). It used to be a control-border edge plus
 *    a foreground ring, and callers each added a third, so the same panel showed a different edge
 *    depending on who opened it;
 *  - the shadow for its elevation: `--shadow-popover` here, `--shadow-drawer` for a modal.
 *
 * Radix-backed primitives compose it with their own sizing and motion. The corner is the shape's:
 * `rounded-xl` for a panel (`POPOVER_SURFACE`), the control radius for a label or toolbar
 * (`FLOATING_SURFACE`).
 */
export const POPOVER_MATERIAL =
  'lx-floating-surface border border-border bg-popover text-popover-foreground shadow-(--shadow-popover)'

/** A floating panel: popover, menu, dropdown, hover card. */
export const POPOVER_SURFACE = `${POPOVER_MATERIAL} rounded-xl`

/** A floating strip at control scale: a toolbar over content, a tooltip label, an action pill. */
export const FLOATING_SURFACE = `${POPOVER_MATERIAL} rounded-md`

/**
 * The same panel over content the app does NOT own — a live preview of someone's page, an
 * embedded document. It carries neither marker class, so no rule written for the app's own
 * surfaces (forced-colors, increased contrast) reaches into a page whose colours it cannot know,
 * and its ground is `--background-solid`, the opaque window ground, rather than the raised one.
 */
export const POPOVER_SURFACE_OVER_FOREIGN =
  'rounded-xl border border-border bg-background-solid text-foreground shadow-(--shadow-popover)'

/**
 * Compact IDE menu geometry shared by dropdown and context-menu families.
 *
 * Menu rows stay at 24px and pointer cursors are reserved for links, and both menu
 * entry points expose the same item vocabulary. Keeping these
 * recipes here makes that contract structural instead of a pair of copied class
 * strings that can drift independently.
 */
export type MenuItemTone = 'default' | 'danger'

/**
 * `max-w-88` is the ceiling a live row cannot argue with. Menu rows are built from data — a branch
 * name, a document title, a connection string — and one long value used to widen the whole panel
 * past the window's half, dragging every short row's hover band out with it. The label truncates
 * against this (see `MenuEntries`), and the full text stays in the row's accessible name.
 */
export const MENU_CONTENT =
  'z-(--z-popover) min-w-[9rem] max-w-88 overflow-x-hidden overflow-y-auto overscroll-contain p-1 scrollbar-thin'
export const MENU_ITEM =
  "relative flex min-h-[var(--chrome-control-sm)] cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-xs/4 text-foreground outline-none transition-colors hover:bg-surface-hover focus:bg-surface-hover data-[highlighted]:bg-surface-hover disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
export const MENU_DANGER_ITEM =
  'text-status-error hover:bg-status-error/10 focus:bg-status-error/10 data-[highlighted]:bg-status-error/10'
export const MENU_LABEL =
  'select-none px-2 py-1 text-2xs font-medium uppercase tracking-wider text-text-faint'
/** Inner dividers are the soft hairline: the surface's own edge is the only full-strength one. */
export const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-border-soft'
export const MENU_SHORTCUT = 'ml-auto shrink-0 pl-4 text-2xs tracking-normal text-text-faint'
/** The radio check at the END of a row — a choice list reads its label first, its state last. */
export const MENU_TRAILING_INDICATOR =
  'ml-auto flex size-3.5 shrink-0 items-center justify-center text-text-faint'

/** Native-Tab command geometry for lifecycle actions in a structured popover footer. */
export const POPOVER_ACTION =
  "flex h-[var(--chrome-control-sm)] w-full shrink-0 select-none items-center justify-start gap-2 rounded-md border border-transparent px-2 text-xs/relaxed font-normal outline-none transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
