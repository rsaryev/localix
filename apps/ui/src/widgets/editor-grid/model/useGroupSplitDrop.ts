import { useState, useCallback, type DragEvent } from 'react'
import { useGridStore, groupOfTab } from '@/features/workspace-grid/model'
import { workItemDragBus, useWorkItemDrag } from '@/shared/lib/workItemDragBus'
import { computeDropZone, resolveDropAction, type DropZone } from './dropZone'

/**
 * Drop handling for one GroupView: tracks the hovered zone for the overlay, and on
 * drop runs the matching pure tree edit (move into this group, or split a new group
 * on an edge and relocate the dragged tab there).
 */
export function useGroupSplitDrop(groupId: string) {
  const moveTab = useGridStore((s) => s.moveTab)
  const splitGroup = useGridStore((s) => s.splitGroup)
  const drag = useWorkItemDrag()
  const [zone, setZone] = useState<DropZone | null>(null)

  const onDragOver = useCallback((e: DragEvent) => {
    if (!workItemDragBus.get()) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    setZone((prev) => computeDropZone(rect, e.clientX, e.clientY, prev))
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (e.currentTarget === e.target) setZone(null)
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const current = workItemDragBus.get()
      const dropZone = zone
      setZone(null)
      workItemDragBus.end()
      if (!current || !dropZone || !current.itemId) return
      const sourceTabCount =
        groupOfTab(useGridStore.getState().root, current.itemId)?.tabs.length ?? 0
      const action = resolveDropAction(dropZone, groupId, current.fromGroup, sourceTabCount)
      if (action.type === 'none') return
      if (action.type === 'move') {
        moveTab(current.itemId, groupId)
        return
      }
      // Edge → new group on that side; relocate the dragged tab into it.
      const newGroupId = splitGroup(groupId, action.dir)
      moveTab(current.itemId, newGroupId)
    },
    [zone, groupId, moveTab, splitGroup],
  )

  return { zone, isDragging: drag !== null, onDragOver, onDragLeave, onDrop }
}
