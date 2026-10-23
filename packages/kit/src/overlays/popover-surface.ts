/**
 * The floating SURFACE — the material every popover, menu and dropdown panel is
 * cut from: the elevated `--popover` fill (NOT `--surface-raised` — that token is
 * the sunken code/composer inset, deliberately darker than the shell, and a menu
 * built from it reads as a flat black cutout instead of a panel floating above
 * everything else), a hairline control border, the popover shadow, and a
 * foreground ring that keeps the edge readable against a dark backdrop.
 *
 * Radix-backed primitives (`popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`)
 * compose it with their own sizing/animation classes. The few coordinate-owned
 * canvas overlays compose it with their explicit placement. It owns the CORNER
 * too — `rounded-xl` is settled for a panel, so a transcribed copy reading
 * `rounded-md` is drift rather than a second variant.
 *
 * The material and its geometry are separate constants because three things float
 * that are not panels: a label (tooltip) and a toolbar (`FLOATING_SURFACE`) take the
 * control radius, and a bottom sheet (the picker drawer) owns its own edge. They used
 * to transcribe the material instead, and each copy dropped a different piece of it —
 * the tooltip had no rim ring, the toolbar no text colour — so the same glass read
 * differently depending on what was cut from it.
 */
export const POPOVER_MATERIAL =
  'lx-floating-surface bg-popover text-popover-foreground shadow-(--shadow-popover) ring-1 ring-foreground/10'

/** A floating panel: popover, menu, dropdown, hover card. */
export const POPOVER_SURFACE = `${POPOVER_MATERIAL} rounded-xl border border-control-border`

/** A floating strip at control scale: a toolbar over content, a tooltip label, an action pill. */
export const FLOATING_SURFACE = `${POPOVER_MATERIAL} rounded-md border border-control-border`

/**
 * The same panel, for the one place the surface above cannot work: floating over content the app
 * does NOT own — a live preview of someone's page, an embedded document.
 *
 * Every reason the standard surface is translucent assumes it frosts over the app's own chrome,
 * whose tone is known. Over a stranger's page it frosts over whatever happens to be there, and 82%
 * white above a beige game board is a card you cannot read — observed exactly that way in the
 * preview's comment composer, where the label, the placeholder and the Attach row all washed out.
 *
 * So this one is opaque, deliberately: `--background-solid` is the token this codebase already keeps
 * for "component fills opt out of glass", and it carries neither of the marker classes the frost
 * rules select on, so no `backdrop-filter` reaches it.
 */
export const POPOVER_SURFACE_OVER_FOREIGN =
  'rounded-xl border border-control-border bg-background-solid text-foreground shadow-(--shadow-popover) ring-1 ring-foreground/10'

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
  "relative flex min-h-[var(--chrome-control-sm)] cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-xs/4 text-foreground outline-none transition-colors hover:bg-popover-hover focus:bg-popover-hover data-[highlighted]:bg-popover-hover disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
export const MENU_DANGER_ITEM =
  'text-status-error hover:bg-status-error/10 focus:bg-status-error/10 data-[highlighted]:bg-status-error/10'
export const MENU_LABEL =
  'select-none px-2 py-1 text-2xs font-medium uppercase tracking-wider text-text-faint'
export const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-border'
export const MENU_SHORTCUT = 'ml-auto shrink-0 pl-4 text-2xs tracking-normal text-text-faint'
/** The radio check at the END of a row — a choice list reads its label first, its state last. */
export const MENU_TRAILING_INDICATOR =
  'ml-auto flex size-3.5 shrink-0 items-center justify-center text-text-faint'

/** Native-Tab command geometry for lifecycle actions in a structured popover footer. */
export const POPOVER_ACTION =
  "flex h-[var(--chrome-control-sm)] w-full shrink-0 select-none items-center justify-start gap-2 rounded-md border border-transparent px-2 text-xs/relaxed font-normal outline-none transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
