import { useEffect, useRef, useState } from 'react'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'

/**
 * The search query of a palette that the UI overlay bus can open. A request opens the palette
 * with its `query` param (replacing the query in place when already open); every other opening
 * starts from an empty query, so a stale search never lingers.
 */
export function useOverlayPaletteQuery(
  overlayId: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
) {
  const [query, setQuery] = useState('')
  const requestedQuery = useRef<string | null>(null)

  useEffect(
    () =>
      subscribeUiOverlay(overlayId, (params) => {
        const query = typeof params.query === 'string' ? params.query : ''
        requestedQuery.current = query
        if (open) {
          setQuery(query)
          requestedQuery.current = null
        }
        onOpenChange(true)
      }),
    [overlayId, onOpenChange, open],
  )

  // Reset the query each time the palette opens so a stale search never lingers.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the palette opens
    if (open) {
      setQuery(requestedQuery.current ?? '')
      requestedQuery.current = null
    }
  }, [open])

  return [query, setQuery] as const
}
