/**
 * ONE VIRTUAL ROW of the transcript, measured and addressable through the same element.
 *
 * A component rather than markup inside the list's `map`, because `useUiTarget` is a hook and a
 * hook cannot be called per row of a loop. The two refs share one callback: a row whose measured
 * box and whose navigation target were different elements would scroll a jump to a place the
 * virtualizer has not sized.
 */
import { useCallback, type ReactNode } from 'react'
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual'
import { useUiTarget } from '@/shared/hooks/useUiTarget'

export function AddressableMessageRow({
  uri,
  item,
  virtualizer,
  children,
}: {
  uri: string | undefined
  item: VirtualItem
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  children: ReactNode
}) {
  const targetRef = useUiTarget<HTMLDivElement>(uri)
  const rowRef = useCallback(
    (element: HTMLDivElement | null) => {
      virtualizer.measureElement(element)
      targetRef(element)
    },
    [targetRef, virtualizer],
  )

  return (
    <div
      data-index={item.index}
      ref={rowRef}
      tabIndex={-1}
      className="absolute left-0 top-0 w-full px-6 max-sm:px-4"
      style={{ transform: `translateY(${item.start}px)`, contain: 'layout paint' }}
    >
      {children}
    </div>
  )
}
