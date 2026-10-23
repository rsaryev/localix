import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Implements the WAI-ARIA tab keyboard contract while keeping focus and
 * selection on the same resource tab after an arrow/Home/End navigation. */
export function handleResourceTabKeyDown<Resource extends string>(
  event: ReactKeyboardEvent<HTMLElement>,
  order: readonly Resource[],
  selected: Resource,
  onChange: (resource: Resource) => void,
): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()

  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]'),
  )
  const focusedIndex = tabs.indexOf(event.target as HTMLButtonElement)
  const selectedIndex = order.indexOf(selected)
  const currentIndex = focusedIndex >= 0 ? focusedIndex : Math.max(0, selectedIndex)
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? order.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length
  const next = order[nextIndex]
  if (!next) return

  tabs[nextIndex]?.focus()
  onChange(next)
}
