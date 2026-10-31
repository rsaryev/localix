/**
 * A ref callback that focuses its element as it mounts. For a field the person asked for
 * (rename, find, a secret the agent requested): the browser's `autoFocus` attribute is the page-load
 * behaviour the accessibility rule warns about, while this focuses only when the field appears. It
 * is a stable function, so React calls it once per mount, never on a re-render.
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus()
}
