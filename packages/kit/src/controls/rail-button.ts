/**
 * Shared rail-button styling for the workspace navigation rail.
 *
 * The rail icon buttons (new chat, history, sections, main views, theme toggle,
 * desktop-update, etc.) all share this base; `railBtnActive` is added when a
 * button represents the open panel/view. It stays in `shared/ui` because this is
 * a reusable chrome appearance, while the workspace widget owns navigation.
 *
 * Rail appearance only; shared IconButton owns geometry, focus, press and disabled
 * behavior. The active state combines a quiet fill with a 2px edge marker, so it
 * remains identifiable without relying on color alone.
 */
export const railBtn =
  'relative cursor-pointer rounded-lg bg-transparent text-text-soft hover:bg-surface-hover hover:text-foreground'

export const railBtnActive =
  'bg-surface-active text-foreground before:absolute before:-left-1 before:h-5 before:w-0.5 before:rounded-r-full before:bg-foreground'

/**
 * The same "this is on" state for a button living in the HORIZONTAL status bar.
 *
 * `railBtnActive`'s edge marker belongs to a VERTICAL rail: it hangs a 20px bar
 * four pixels OUTSIDE the button's left edge, which is the activity-bar
 * convention and reads correctly stacked. Reused in the status bar it was simply
 * wrong — the bar is taller than the strip it sits in, it is not the full height
 * of the cell it marks, and it lands on top of the `divide-x` hairline the bar
 * already draws between items, so the state read as a stray, misaligned line
 * beside the button rather than as the button being on.
 *
 * The status bar's own language is full-height tinted cells separated by
 * hairlines, so "on" is the tint plus a full-width marker along the bottom edge —
 * inside the cell, aligned to it, and never colliding with a divider.
 */
export const statusBtnActive =
  'bg-surface-active text-foreground before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-foreground'
