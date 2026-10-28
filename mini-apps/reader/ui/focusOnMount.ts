/**
 * A ref callback that takes the focus when its element is first shown: for a field that appears to
 * be typed into (an editor that opens, a dialog's first field). It is the moment the `autoFocus`
 * attribute picked, the commit that mounts the element, wherever a portal mounts it. The identity
 * never changes, so a re-render does not take the focus again.
 */
export function focusOnMount(node: HTMLElement | null): void {
  node?.focus()
}
