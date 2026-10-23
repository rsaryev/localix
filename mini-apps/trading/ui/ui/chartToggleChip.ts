/**
 * The chart toolbar's toggle chip — one recipe for the four controls that had
 * transcribed it independently (chart type, indicators, analysis, and the canvas
 * draw/snap toggles). Same geometry, same two states, one place to change.
 *
 * Both states are foreground VEILS, never `bg-surface-raised`: that token mixes
 * from a DARKER ground than the chart pane the toolbar sits on, so at full
 * strength the active chip read as a black lozenge and at `/70` the resting one
 * read as a slightly-less-black lozenge. A veil takes the pane's own colour and
 * only adds density — 11% for "this one is on", 4% at rest.
 */
export function chartToggleChip(active: boolean): string {
  return active
    ? 'border-border bg-surface-active text-foreground'
    : 'border-border-soft bg-foreground/[0.04] text-text-faint hover:bg-surface-hover hover:text-text-soft'
}
