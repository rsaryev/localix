import { useCallback, useState } from 'react'
import type { SpaceDocument } from '../../shared/format/document'
import { groupsOf } from '../../shared/ops/groups'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { drillInto, selectedGroups, staysInside, withGroups } from './selection'

/**
 * What is selected on the board, and the group the person has entered — the one question of
 * WHICH elements the person means, apart from where they are (`useLiveBoard`).
 *
 * The rules are `selection.ts`'s: a click or a drag-select takes a grouped element's whole group;
 * a second click on it (or Enter) reaches one level in; a selection outside the entered group, or
 * a click on the ground, lets go of it. The callbacks are handed to the flow library once, so
 * they read the board through a ref instead of being remade on every render.
 */
export function useBoardSelection(space: SpaceDocument) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [entered, setEntered] = useState<string | null>(null)
  const board = useLatest({ space, entered, selected })

  /** Select exactly these (or add them); a selection outside the entered group lets go of it. */
  const select = useCallback(
    (ids: Iterable<string>, add = false) => {
      const { space: now, entered: inside, selected: current } = board.current
      const next = new Set([...(add ? current : []), ...ids])
      if (!staysInside(now, next, inside)) setEntered(null)
      setSelected(next)
    },
    [board],
  )

  /**
   * The library's selection changes, widened to whole groups. What was just selected decides
   * whether the entered group is kept: a click inside it stays in, a click outside it (or on the
   * ground, which selects nothing) lets go.
   */
  const applySelection = useCallback(
    (selection: Record<string, boolean>) => {
      if (Object.keys(selection).length === 0) return
      const { space: now, entered: inside, selected: current } = board.current
      const on = Object.keys(selection).filter((id) => selection[id])
      const keep = on.length > 0 && staysInside(now, new Set(on), inside) ? inside : null
      const added = withGroups(now, on, keep)
      const off = withGroups(
        now,
        Object.keys(selection).filter((id) => !selection[id]),
        keep,
      )
      const next = new Set(current)
      for (const id of off) if (!added.has(id)) next.delete(id)
      for (const id of added) next.add(id)
      if (keep !== inside) setEntered(keep)
      setSelected(next)
    },
    [board],
  )

  /** A click on an element already selected with its group reaches one level into the group. */
  const onElementClick = useCallback(
    (id: string) => {
      const { space: now, selected: current, entered: inside } = board.current
      const drill = drillInto(now, id, current, inside)
      if (!drill) return
      setEntered(drill.entered)
      setSelected(drill.selection)
    },
    [board],
  )

  /** Enter: the one wholly selected group opens, its parts becoming the units a click takes. */
  const enterGroup = useCallback((): boolean => {
    const { space: now, selected: current, entered: inside } = board.current
    const groups = selectedGroups(now, current, inside)
    const [only] = groups
    if (groups.size !== 1 || !only || only[1].length !== current.size) return false
    setEntered(only[0])
    setSelected(withGroups(now, only[1], only[0]))
    return true
  }, [board])

  /** Escape inside a group: back out to the whole of it. */
  const leaveGroup = useCallback((): boolean => {
    const { space: now, entered: inside } = board.current
    if (!inside) return false
    setEntered(null)
    setSelected(withGroups(now, groupsOf(now).get(inside) ?? [], null))
    return true
  }, [board])

  /** A connector's changes: only its selection is the view's to keep. */
  const onEdgeChanges = useCallback(
    (changes: readonly { type: string; id?: string; selected?: boolean }[]) => {
      const selection: Record<string, boolean> = {}
      for (const change of changes)
        if (change.type === 'select' && change.id) selection[change.id] = change.selected === true
      if (Object.keys(selection).length === 0) return
      setSelected((current) => {
        const next = new Set(current)
        for (const [id, on] of Object.entries(selection))
          if (on) next.add(id)
          else next.delete(id)
        return next
      })
    },
    [],
  )

  /** The groups a dragged element brings along, at the level the selection is at now. */
  const groupOf = useCallback(
    (id: string) => [...withGroups(board.current.space, [id], board.current.entered)],
    [board],
  )

  return {
    selected,
    entered,
    select,
    applySelection,
    onElementClick,
    enterGroup,
    leaveGroup,
    onEdgeChanges,
    groupOf,
  }
}
