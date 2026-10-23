/**
 * A small curated palette of named color tags a connection can carry (NOT free-form
 * hex) — a prod-safety cue so a user juggling several databases can tell them apart at
 * a glance. Purely presentational metadata: it never affects query execution. Mapped to
 * theme-aware CSS on the UI side (`ui/model/connectionColor.ts`).
 *
 * Lives in its own zod-free leaf (not `contracts.ts`) so the UI can value-import the
 * palette without dragging the backend's schema construction into the browser bundle.
 */
export const CONNECTION_COLORS = [
  'red',
  'amber',
  'green',
  'blue',
  'violet',
  'pink',
  'slate',
] as const
export type ConnectionColor = (typeof CONNECTION_COLORS)[number]
