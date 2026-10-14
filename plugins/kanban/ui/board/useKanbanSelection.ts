import { useCallback, useMemo, useRef, useState } from 'react'

/** Which modifier drove a card click, following the file-tree list-selection model. */
export interface SelectMods {
  /** ⌘/Ctrl-click: add/remove this one card, move the anchor. */
  toggle?: boolean
  /** Shift-click: select the contiguous range from the anchor to this card. */
  range?: boolean
}

/**
 * Multi-select state for the board's leaf cards, following the same list model
 * the file tree uses: ⌘/Ctrl toggles one, Shift spans a
 * contiguous range from the anchor over the visible reading order, a plain modifier
 * click replaces the selection. `flatIds` is that reading order (see
 * `flattenLeafIds`); passing it fresh each render keeps ranges anchored to what's
 * on screen. `selected` is auto-pruned to ids still present in `flatIds`, so cards
 * an agent moved/deleted out from under the user silently drop from the selection.
 */
export function useKanbanSelection(flatIds: string[]) {
  const [raw, setRaw] = useState<Set<string>>(() => new Set())
  const anchorRef = useRef<string | null>(null)

  // Derived (not stored) so stale ids never leak into an action without needing a
  // set-state effect to prune them.
  const present = useMemo(() => new Set(flatIds), [flatIds])
  const selected = useMemo(() => {
    const next = new Set<string>()
    for (const id of raw) if (present.has(id)) next.add(id)
    return next
  }, [raw, present])

  const selectCard = useCallback(
    (id: string, mods: SelectMods) => {
      setRaw((prev) => {
        if (mods.range && anchorRef.current) {
          const order = flatIds
          const a = order.indexOf(anchorRef.current)
          const b = order.indexOf(id)
          if (a === -1 || b === -1) {
            anchorRef.current = id
            return new Set([id])
          }
          const [lo, hi] = a < b ? [a, b] : [b, a]
          return new Set(order.slice(lo, hi + 1))
        }
        if (mods.toggle) {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          anchorRef.current = id
          return next
        }
        anchorRef.current = id
        return new Set([id])
      })
    },
    [flatIds],
  )

  const clear = useCallback(() => {
    anchorRef.current = null
    setRaw((prev) => (prev.size === 0 ? prev : new Set()))
  }, [])

  return { selected, selectCard, clear }
}
