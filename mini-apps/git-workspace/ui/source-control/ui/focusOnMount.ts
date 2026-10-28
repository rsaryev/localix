/**
 * The `autoFocus` attribute, done by hand: a ref callback focuses the field once, when it mounts.
 * It is declared once at module scope so its identity never changes; an inline arrow would run
 * again on every render and steal focus back.
 */
export const focusOnMount = (element: HTMLElement | null) => {
  element?.focus()
}
