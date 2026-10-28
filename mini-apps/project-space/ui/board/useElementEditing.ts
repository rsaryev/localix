import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import type { SpaceDocument } from '../../shared/format/document'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { createFlagStore, type BoardActions } from './context'

/** Publish stable board selection; the flow library's callback-dependent event can render-loop. */
export function usePublishBoardSelection(
  selected: ReadonlySet<string>,
  onSelection: (ids: readonly string[]) => void,
) {
  useEffect(() => onSelection([...selected]), [selected, onSelection])
}

export function useElementEditing(root: RefObject<HTMLElement | null>) {
  const [editing, setEdited] = useState<string | null>(null)
  const setEditing = useCallback(
    (id: string | null) => {
      // An inline editor disappears on completion. Keep the next native Undo on its board,
      // while a blur into another control leaves that control in charge of keyboard focus.
      const focused = document.activeElement
      if (
        id === null &&
        root.current?.contains(focused) &&
        (focused?.matches('input, textarea, [contenteditable="true"]') ||
          focused?.closest('[data-space-editor]'))
      )
        root.current.querySelector<HTMLElement>('.localix-canvas')?.focus({ preventScroll: true })
      setEdited(id)
    },
    [root],
  )
  return { editing, setEditing }
}

/** Stable node actions avoid redrawing every node when only selection or editing changes. */
export function useElementActions({
  sessionId,
  apply,
  grow,
  focus,
  setEditing,
  editing,
  selected,
  space,
}: {
  sessionId: string
  apply: BoardActions['apply']
  grow: BoardActions['grow']
  focus: BoardActions['focus']
  setEditing: BoardActions['setEditing']
  editing: string | null
  selected: ReadonlySet<string>
  space: SpaceDocument
}): { actions: BoardActions; selectedElements: string[]; selectedEdge: string | undefined } {
  const growRef = useLatest(grow)
  const focusRef = useLatest(focus)
  const [flags] = useState(createFlagStore)
  const elements = [...selected].filter((id) => space.elements[id])
  const selectedEdge = [...selected].find((id) => space.edges[id])
  const single =
    elements.length === 1 && ![...selected].some((id) => space.edges[id]) ? elements[0]! : null
  useLayoutEffect(() => flags.set({ editing, single }), [flags, editing, single])
  const actions = useMemo<BoardActions>(
    () => ({
      sessionId,
      apply,
      setEditing,
      grow: (id, side) => growRef.current(id, side),
      focus: (id) => focusRef.current(id),
      flags,
    }),
    [sessionId, apply, setEditing, flags, growRef, focusRef],
  )
  return { actions, selectedElements: elements, selectedEdge }
}
