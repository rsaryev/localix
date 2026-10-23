import { useRef, type ClipboardEvent, type DragEvent, type PointerEvent } from 'react'
import { runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { useCanvasCamera } from '@localixai/kit/canvas'
import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { copySelection, pasteOps } from '../content/clipboard'
import { incomingFromDrop, incomingFromPaste, opsFor } from '../content/pipeline'

/**
 * The board's doors to the outside: drop, paste, copy and cut. Content lands where the pointer
 * last was over the board, or in the middle of the view when it never was (a paste from the menu).
 * A key or a paste aimed at a field on the board is the field's.
 */
/**
 * The drop effect the SOURCE allows. The board takes a copy, but an editor tab arms its link on
 * top of its own `move` reorder gesture, and a drop effect the source did not allow makes the
 * browser refuse the drop: a tab dragged onto the board landed nowhere.
 */
export function dropEffectFor(allowed: string): 'copy' | 'link' | 'move' {
  if (allowed === 'uninitialized' || allowed === 'all' || /copy/iu.test(allowed)) return 'copy'
  return /link/iu.test(allowed) ? 'link' : 'move'
}

export function useBoardIO(deps: {
  sessionId: string
  space: SpaceDocument
  selected: ReadonlySet<string>
  commit: (ops: readonly SpaceOp[]) => void
}) {
  const camera = useCanvasCamera()
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const place = () => pointer.current ?? camera.centre()
  const inField = (target: EventTarget) =>
    !!(target as HTMLElement).closest?.('input, textarea, [contenteditable="true"]')

  const land = (make: () => Promise<SpaceOp[]>) =>
    runMiniAppAction(async () => deps.commit(await make()), 'Could not put that on the board')

  return {
    /** The rail's Add files: the picked files land in the middle of the view. */
    addFiles: () =>
      runMiniAppAction(async () => {
        const paths = await miniAppFiles.pickFiles()
        if (paths.length === 0) return
        const items = paths.map((path) => ({ kind: 'path' as const, path, isDir: false }))
        deps.commit(await opsFor(items, camera.centre(), deps.sessionId, deps.space))
      }, 'Could not add those files'),
    onPointerMove: (event: PointerEvent) => {
      pointer.current = camera.toBoard(event.clientX, event.clientY)
    },
    onPointerLeave: () => {
      pointer.current = null
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed)
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const at = camera.toBoard(event.clientX, event.clientY)
      const transfer = event.dataTransfer
      land(async () => opsFor(await incomingFromDrop(transfer), at, deps.sessionId, deps.space))
    },
    onPaste: (event: ClipboardEvent) => {
      if (inField(event.target)) return
      event.preventDefault()
      const at = place()
      const own = pasteOps(deps.space, event.clipboardData.getData('text/plain'), at)
      if (own) return deps.commit(own)
      const items = incomingFromPaste(event.clipboardData)
      land(() => opsFor(items, at, deps.sessionId, deps.space))
    },
    onCopy: (event: ClipboardEvent) => {
      if (inField(event.target)) return
      const text = copySelection(deps.space, [...deps.selected])
      if (text === null) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
    },
    onCut: (event: ClipboardEvent) => {
      if (inField(event.target)) return
      const text = copySelection(deps.space, [...deps.selected])
      if (text === null) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
      deps.commit([...deps.selected].map((id) => ({ op: 'delete', id })))
    },
  }
}
