import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/shared/lib/notify'

import {
  type AttachmentGate,
  type PendingAttachment,
  attachmentGate,
} from '@/shared/lib/attachment-policy'
import { filesToAttachments, voiceBlobToAttachment } from '@/shared/lib/attachments/file-staging'

export interface ComposerAttachments {
  /** Pending (not-yet-sent) attachments staged in the composer. */
  attachments: PendingAttachment[]
  /** Modality gate derived from the active model's input modalities. */
  gate: AttachmentGate
  addFiles: (files: File[], signal?: AbortSignal) => Promise<void>
  addVoice: (blob: Blob, durationMs: number) => Promise<void>
  removeAttachment: (id: string) => void
  /** Drops all staged attachments, or only the submitted ids, and revokes their object URLs. */
  clearAttachments: (ids?: readonly string[]) => void
}

/**
 * Composer attachment staging: holds the pending-attachment list, uses the
 * active model's input modalities to choose native content vs file handoff,
 * and revokes preview object-URLs on removal/clear. Extracted from ChatSurface
 * so the widget stays an orchestrator.
 */
export function useComposerAttachments(inputModalities: string[] | undefined): ComposerAttachments {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])

  // Mirror the live list into a ref so the unmount cleanup below revokes the
  // CURRENT preview URLs (an empty-dep effect would otherwise close over the
  // initial empty list and leak any staged-but-unsent previews on unmount).
  const attachmentsRef = useRef(attachments)
  // eslint-disable-next-line react-hooks/refs
  attachmentsRef.current = attachments
  useEffect(
    () => () => {
      for (const p of attachmentsRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
    },
    [],
  )

  const gate = useMemo(() => attachmentGate(inputModalities), [inputModalities])

  const addFiles = useCallback(
    async (files: File[], signal?: AbortSignal) => {
      const { pending, rejected, notedFailures } = await filesToAttachments(files, gate)
      if (signal?.aborted) {
        for (const item of pending) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
        return
      }
      if (pending.length > 0) setAttachments((prev) => [...prev, ...pending])
      if (rejected.length > 0) {
        // The per-file reasons used to be glued into the headline, so three failed uploads
        // painted a paragraph across the notification. The count is the headline; the list —
        // which is the only part an operator needs verbatim — is the body.
        const note =
          notedFailures > 0
            ? `\n\nAdded ${notedFailures} explanatory note${notedFailures === 1 ? '' : 's'} to the message so it can still send.`
            : ''
        toast.error(
          rejected.length === 1
            ? 'Could not attach one file'
            : `Could not attach ${rejected.length} files`,
          { description: `${rejected.join('\n')}${note}` },
        )
      }
    },
    [gate],
  )

  const addVoice = useCallback(async (blob: Blob, durationMs: number) => {
    const pending = await voiceBlobToAttachment(blob, durationMs)
    setAttachments((prev) => [...prev, pending])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((p) => p.id === id)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  const clearAttachments = useCallback((ids?: readonly string[]) => {
    if (ids?.length === 0) return
    const selected = ids ? new Set(ids) : null
    setAttachments((prev) => {
      const removed = selected ? prev.filter((pending) => selected.has(pending.id)) : prev
      for (const pending of removed) {
        if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
      }
      return selected ? prev.filter((pending) => !selected.has(pending.id)) : []
    })
  }, [])

  return { attachments, gate, addFiles, addVoice, removeAttachment, clearAttachments }
}
