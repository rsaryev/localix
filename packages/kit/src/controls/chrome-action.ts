/**
 * Compact workbench action used in persistent chrome (titlebar/header bars).
 *
 * Geometry is tokenized in index.css so host and plugin actions keep the same
 * physical hit target when typography density changes. The class intentionally
 * owns interaction feedback as well: a chrome action should never invent its own
 * focus, hover, pressed, or reduced-motion behavior.
 */
export const chromeAction =
  'relative flex h-[var(--chrome-control-md)] min-w-[var(--chrome-control-md)] shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-text-soft outline-none focus-ring transition-[color,background-color,box-shadow] hover:bg-surface-hover hover:text-foreground active:bg-surface-active motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50'

export const chromeActionActive = 'bg-surface-active text-foreground'
