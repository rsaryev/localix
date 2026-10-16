import { useCallback, useMemo, useState } from 'react'

/** Click modifiers that turn a plain row click into a multi-select gesture. */
export interface SelectMods {
  /** ⌘/Ctrl — add/remove this one row, keeping the rest of the selection. */
  toggle?: boolean
  /** Shift — select the contiguous span from the anchor to this row. */
  range?: boolean
}

export interface SelectionState {
  selected: Set<string>
  /** The row a range extends from — set by the last plain/toggle pick. */
  anchorId: string | null
}

/**
 * The contiguous span of ids between `anchorId` and `targetId` (inclusive) over
 * the given visual order. No anchor (or anchor gone from the list) → just the
 * target. Pure — the core of shift-range selection, unit-tested in isolation.
 */
export function rangeIds(
  orderedIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const ti = orderedIds.indexOf(targetId)
  if (ti < 0) return []
  const ai = anchorId ? orderedIds.indexOf(anchorId) : -1
  if (ai < 0) return [targetId]
  const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai]
  return orderedIds.slice(lo, hi + 1)
}

/**
 * The neighbour of `fromId` one step in `dir` (-1 up, +1 down) over the visual
 * order, or null at (or off) the ends. Pure — the core of arrow-key roster
 * traversal, unit-tested in isolation.
 */
export function stepId(orderedIds: string[], fromId: string, dir: -1 | 1): string | null {
  const i = orderedIds.indexOf(fromId)
  if (i < 0) return null
  const j = i + dir
  return j >= 0 && j < orderedIds.length ? orderedIds[j] : null
}

/**
 * Pure selection reducer. Shift = replace selection with the span from the
 * (unmoved) anchor; ⌘/Ctrl = toggle one row and re-anchor on it; no modifier =
 * select just this row. Mirrors the file-tree multi-select semantics.
 */
export function applySelect(
  state: SelectionState,
  id: string,
  mods: SelectMods,
  orderedIds: string[],
): SelectionState {
  if (mods.range) {
    return {
      selected: new Set(rangeIds(orderedIds, state.anchorId, id)),
      anchorId: state.anchorId ?? id,
    }
  }
  if (mods.toggle) {
    const next = new Set(state.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { selected: next, anchorId: id }
  }
  return { selected: new Set([id]), anchorId: id }
}

export interface SessionSelection {
  selected: Set<string>
  count: number
  isSelectionActive: boolean
  isSelected: (id: string) => boolean
  select: (id: string, mods: SelectMods, orderedIds: string[]) => void
  clear: () => void
}

/** React wrapper over the pure selection reducer for the sidebar roster. */
export function useSessionSelection(): SessionSelection {
  const [state, setState] = useState<SelectionState>({ selected: new Set(), anchorId: null })

  const select = useCallback((id: string, mods: SelectMods, orderedIds: string[]) => {
    setState((prev) => applySelect(prev, id, mods, orderedIds))
  }, [])

  const clear = useCallback(() => {
    setState((prev) => (prev.selected.size === 0 ? prev : { selected: new Set(), anchorId: null }))
  }, [])

  const isSelected = useCallback((id: string) => state.selected.has(id), [state.selected])

  return useMemo(
    () => ({
      selected: state.selected,
      count: state.selected.size,
      isSelectionActive: state.selected.size > 0,
      isSelected,
      select,
      clear,
    }),
    [state.selected, isSelected, select, clear],
  )
}
