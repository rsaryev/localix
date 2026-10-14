/**
 * One cell rhythm for the stats panel's two data tables (breakdown + requests)
 * so their columns share the same seam under the stacked StatSections.
 */
export const TABLE_TH = 'py-2 px-2.5 font-medium'
export const TABLE_TD = 'py-2 px-2.5'

/* Pane-hue, not `bg-surface-raised`: raised mixes from a DARKER ground than the pane,
   so under the glass theme the sticky header read as an abrupt black strip. `/95` keeps
   the coat occluding (rows scroll under it) while escaping the once-only ground rule
   with the pane's own colour. No backdrop-blur: at a 95% fill there is nothing left to
   blur, and the resample cost lands on every scroll frame. */
export const TABLE_STICKY_HEAD = 'sticky top-0 z-(--z-sticky) lx-occluder'
