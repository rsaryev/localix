/**
 * Shared material for app-level modal surfaces. Shape, border edges, layout and
 * animation remain specific to a centered dialog, confirmation or bottom drawer;
 * elevation and theme material must not drift between those form factors.
 */
export const modalSurface =
  'lx-modal-surface bg-surface-raised text-popover-foreground shadow-(--shadow-drawer)'
/** Modal shells clip; exactly one nested Body owns overflow. */
export const modalShell = 'flex min-h-0 flex-col overflow-hidden'

/** Shared information hierarchy for centered dialogs, alerts and drawers. */
export const modalTitle =
  'min-w-0 text-balance break-words text-base font-semibold leading-snug tracking-normal text-foreground'
export const modalDescription = 'break-words text-xs/relaxed text-text-soft'

/**
 * Modal regions own spacing as well as information hierarchy. Keeping the shell
 * padding-free makes Header / Body / Footer geometry identical in Dialog,
 * AlertDialog and Drawer, while edge-to-edge surfaces can intentionally omit the
 * regions (quick open, media lightbox, embedded HITL).
 */
export const modalHeader = 'flex shrink-0 items-start gap-3 px-4 pb-3 pt-4'
export const modalHeaderMain = 'flex min-w-0 flex-1 flex-col gap-1'
export const modalHeaderActions =
  'flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1'
/**
 * The only shrinkable scroll viewport: actions and context stay pinned around it — and it
 * scrolls on ONE axis.
 *
 * `overflow-x-clip`, not `-hidden`: `hidden` still makes the box a scroll container on x, so
 * content that overflowed became unreachable rather than absent, and the two together are what
 * a "hidden horizontal scrollbar" actually is. `clip` cannot scroll at all, and — unlike
 * `hidden` — it does not drag the other axis into `auto`, so "vertical only" is stated rather
 * than emerging from CSS's overflow-pairing rule.
 *
 * It is a BACKSTOP, not the mechanism. Dialog content is expected not to overflow horizontally
 * in the first place: `min-w-0` on flex/grid children (both default to `auto`, which refuses to
 * shrink below the content), and an explicit break strategy on anything that can arrive as one
 * long token — `truncate` for a single-line identifier, `break-all` for mono, `wrap-anywhere`
 * for prose.
 */
export const modalBody =
  'min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain px-4 pb-4 scrollbar-thin'
export const modalFooter =
  'flex shrink-0 flex-col-reverse gap-2 border-t border-border-soft px-4 py-3 sm:flex-row sm:items-center'
export const modalFooterAside = 'flex min-w-0 items-center sm:mr-auto'
export const modalFooterActions =
  'flex min-w-0 flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:items-center sm:justify-end'
