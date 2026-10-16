/**
 * Is the user typing into this element right now?
 *
 * The companion to `isNonTextWritingKey`: that one asks about the KEY, this one about the TARGET,
 * and a surface deciding whether a keypress is a shortcut usually needs both. Shared because the
 * two copies that existed disagreed — one covered `contentEditable`, the other checked only
 * `INPUT` and `TEXTAREA`, so digit shortcuts fired while the user typed into a rich-text field.
 */

/** True while the element takes text input, so the keys belong to the user, not to a shortcut. */
export function isTypingTarget(element: Element | null): boolean {
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (element as HTMLElement).isContentEditable
}
