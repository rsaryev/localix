import { useCallback, useEffect, useRef, useState } from 'react'

import { LARGE_PASTE_CHARS } from '@/shared/lib/attachment-policy'
import { rememberDroppedFilePath } from '@/shared/lib/attachments/file-staging'
import { desktopDroppedEntries } from '@/shared/lib/fileDropRouter'
import {
  readMessageBindingDrag,
  type MessageBindingDragPayload,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { acceptedDragKind, createDragDepth } from './dropzoneState'

/** No `dragover` for this long means the drag ended where the window could not hear it. */
export const STALE_DRAG_MS = 1500

export interface ComposerDropzoneDeps {
  onAddFiles?: (files: File[]) => void
  /**
   * An agent-linkable object dropped on the composer (file-tree row, sessions
   * row, terminal tab, tool-call card, …). ONE callback for every kind — the
   * host routes it to the matching token (link-only `@path` mention, or a
   * `@session:`/`@terminal:`/`@call:` context-ref). Legacy MIMEs are folded in.
   */
  onMessageBinding?: (payload: MessageBindingDragPayload) => void
  /** When false, paste/drop attachment capture is disabled with the composer itself. */
  attachEnabled: boolean
}

export interface ComposerDropzone {
  /** True while an accepted drag hovers the composer (drives the drop overlay). */
  dragging: boolean
  /**
   * Kind of the hovering drag — a message-binding kind (`file`/`session`/
   * `terminal`/`call`/…) or `'files'` for OS attachments; `null` when idle.
   * Drives kind-specific overlay copy ("Link tool call to message" vs
   * "Drop files to attach").
   */
  dragKind: string | null
  handleFiles: (files: File[]) => void
  handlePaste: (e: React.ClipboardEvent) => void
  handleDrop: (e: React.DragEvent) => void
  handleDragEnter: (e: React.DragEvent) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
}

/**
 * Composer drop capture: message-binding drags (one MIME, routed by kind), OS file
 * attachments, and paste (files, or a very large text paste demoted to a .txt
 * attachment instead of flooding the textarea). Gated by `attachEnabled`.
 *
 * Overlay lifecycle is made stick-proof three ways:
 * - a dragenter/dragleave DEPTH COUNTER (child enter/leave storms never clear
 *   or strand the overlay — see `createDragDepth`);
 * - window-level `dragend` + `drop` listeners (a drag cancelled with Esc or
 *   dropped on ANOTHER target never fires drop/leave on the composer);
 * - a window `dragleave` with no relatedTarget (drag left the window entirely);
 * - pointer movement or `STALE_DRAG_MS` without `dragover` (a drag that ended outside
 *   the window without any event, like the macOS screenshot thumbnail).
 */
export function useComposerDropzone({
  onAddFiles,
  onMessageBinding,
  attachEnabled,
}: ComposerDropzoneDeps): ComposerDropzone {
  const [dragKind, setDragKind] = useState<string | null>(null)
  const depthRef = useRef<ReturnType<typeof createDragDepth> | null>(null)
  const depth = (depthRef.current ??= createDragDepth())

  const clearDrag = useCallback(() => {
    depth.reset()
    setDragKind(null)
  }, [depth])

  const acceptKind = useCallback(
    (e: React.DragEvent): string | null => {
      return acceptedDragKind(Array.from(e.dataTransfer?.types ?? []), {
        messageBinding: Boolean(onMessageBinding),
        attach: attachEnabled,
      })
    },
    [attachEnabled, onMessageBinding],
  )

  // While a drag hovers, arm global fallbacks: the composer never hears about
  // a drag that ends elsewhere (Esc cancel → dragend on the SOURCE; drop on a
  // different target → drop there; drag leaves the window → nothing at all).
  useEffect(() => {
    if (dragKind === null) return
    const onWindowDragLeave = (e: DragEvent) => {
      if (
        e.relatedTarget === null &&
        (e.target === document ||
          e.target === document.documentElement ||
          e.target === document.body)
      )
        clearDrag()
    }
    // A drag that ends outside the window sends nothing at all — the macOS screenshot
    // thumbnail is one. A live drag sends `dragover` continuously and suppresses pointer
    // events, so pointer movement or a silent stretch both mean the drag is over.
    let staleTimer = setTimeout(clearDrag, STALE_DRAG_MS)
    const onWindowDragOver = () => {
      clearTimeout(staleTimer)
      staleTimer = setTimeout(clearDrag, STALE_DRAG_MS)
    }
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('pointermove', clearDrag, true)
    window.addEventListener('dragend', clearDrag, true)
    window.addEventListener('drop', clearDrag, true)
    window.addEventListener('blur', clearDrag)
    window.addEventListener('dragleave', onWindowDragLeave, true)
    return () => {
      clearTimeout(staleTimer)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('pointermove', clearDrag, true)
      window.removeEventListener('dragend', clearDrag, true)
      window.removeEventListener('drop', clearDrag, true)
      window.removeEventListener('blur', clearDrag)
      window.removeEventListener('dragleave', onWindowDragLeave, true)
    }
  }, [dragKind, clearDrag])

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length > 0) onAddFiles?.(files)
    },
    [onAddFiles],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!attachEnabled) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) {
        e.preventDefault()
        handleFiles(files)
        return
      }
      // Huge clipboard text becomes a text-file attachment instead of flooding the textarea.
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.length > LARGE_PASTE_CHARS) {
        e.preventDefault()
        handleFiles([new File([text], 'pasted-text.txt', { type: 'text/plain' })])
      }
    },
    [attachEnabled, handleFiles],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      clearDrag()
      // Anything draggable-to-the-agent (file row, session, terminal tab, tool
      // call) rides the unified message-binding MIME; the host inserts the right token.
      if (onMessageBinding && e.dataTransfer) {
        const payload = readMessageBindingDrag(e.dataTransfer)
        if (payload) {
          e.preventDefault()
          onMessageBinding(payload)
          return
        }
      }
      e.preventDefault()
      if (!attachEnabled) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      void desktopDroppedEntries(files).then((entries) => {
        entries?.forEach((entry, index) => {
          if (!entry.isDir) rememberDroppedFilePath(files[index]!, entry.path)
        })
        handleFiles(files)
      })
    },
    [attachEnabled, clearDrag, handleFiles, onMessageBinding],
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      const kind = acceptKind(e)
      if (!kind) return
      e.preventDefault()
      depth.enter()
      setDragKind((prev) => (prev === kind ? prev : kind))
    },
    [acceptKind, depth],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      const kind = acceptKind(e)
      if (!kind) return
      // preventDefault marks the composer a valid drop target (required every
      // dragover). NOTE: dropEffect is left alone — sources advertise different
      // effectAllowed ('copy' rows, 'move' tabs) and forcing one would veto drops.
      e.preventDefault()
      // A drag can materialize via dragover alone (enter missed / drag armed
      // while already over us) — make sure the depth reflects "inside".
      if (depth.value === 0) depth.enter()
      setDragKind((prev) => (prev === kind ? prev : kind))
    },
    [acceptKind, depth],
  )

  const handleDragLeave = useCallback(() => {
    if (dragKind === null) return
    if (depth.leave() === 0) setDragKind(null)
  }, [depth, dragKind])

  return {
    dragging: dragKind !== null,
    dragKind,
    handleFiles,
    handlePaste,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
  }
}
