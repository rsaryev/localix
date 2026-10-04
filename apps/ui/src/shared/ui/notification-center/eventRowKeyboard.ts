/**
 * Arrow-key travel between journal rows. The rows are separate components, so the list is found
 * from the focused trigger rather than held in state: a row removed from the keyboard hands focus to
 * its neighbour without the list having to know which one that is.
 */

const ROW_TRIGGER = '[data-event-row-trigger]'

function rowTriggers(trigger: HTMLButtonElement): HTMLButtonElement[] {
  const list = trigger.closest('ul')
  return list ? [...list.querySelectorAll<HTMLButtonElement>(ROW_TRIGGER)] : []
}

export function moveRowFocus(
  trigger: HTMLButtonElement,
  key: 'previous' | 'next' | 'first' | 'last',
): void {
  const triggers = rowTriggers(trigger)
  const currentIndex = triggers.indexOf(trigger)
  const targetIndex =
    key === 'first'
      ? 0
      : key === 'last'
        ? triggers.length - 1
        : key === 'previous'
          ? Math.max(0, currentIndex - 1)
          : Math.min(triggers.length - 1, currentIndex + 1)
  triggers[targetIndex]?.focus()
}

/** Remove the focused row, then focus the one after it (or before it, at the end of the list). */
export function removeRowFromKeyboard(trigger: HTMLButtonElement, remove: () => void): void {
  const triggers = rowTriggers(trigger)
  const currentIndex = triggers.indexOf(trigger)
  const next = triggers[currentIndex + 1] ?? triggers[currentIndex - 1]
  remove()
  queueMicrotask(() => next?.focus())
}
