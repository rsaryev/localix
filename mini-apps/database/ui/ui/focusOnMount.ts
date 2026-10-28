/**
 * Ref callback that focuses its element once, when it mounts: the `autoFocus` attribute done by
 * hand, for fields that appear because the person asked for them (a rename, a dialog). Module
 * scope keeps its identity stable, so React calls it on mount only, never on re-render.
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus()
}
