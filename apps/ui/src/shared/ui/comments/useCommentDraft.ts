import { useCallback, useMemo, useState } from 'react'
import { useComposerAttachments } from '@/shared/lib/attachments/useComposerAttachments'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'
import type { MessageAttachment } from '@/shared/api/contracts'

/** The id a surface-provided piece of evidence is staged under — removable like any other file. */
const SEED_ID = 'comment-evidence'

/**
 * One comment being written: its note and everything it will carry.
 *
 * Surface-agnostic on purpose. A preview pick arrives with a screenshot the probe just took, a
 * quoted sentence arrives with nothing — but both can have a picture or a file added by hand, and
 * both need the same "start clean when the target changes" behaviour. Keeping that here is what
 * lets text surfaces and the preview render the SAME card instead of two that drift.
 *
 * The seed is offered, not imposed: it stages like any other attachment and can be dropped.
 */
export interface CommentDraft {
  note: string
  setNote: (value: string) => void
  /** The seeded evidence (unless dropped) plus whatever the person added. */
  attachments: PendingAttachment[]
  gate: ReturnType<typeof useComposerAttachments>['gate']
  addFiles: (files: File[]) => void
  removeAttachment: (id: string) => void
  /** Start over — after attaching, or on cancel. */
  reset: () => void
}

export function useCommentDraft(
  /** Evidence the surface captured with the target, if any. */
  seed: MessageAttachment | undefined,
  /** Identity of the thing being commented on — a new one starts a clean draft. */
  target: string | undefined,
): CommentDraft {
  const [note, setNote] = useState('')
  const [seedDropped, setSeedDropped] = useState(false)
  const {
    attachments: added,
    gate,
    addFiles,
    removeAttachment,
    clearAttachments,
  } = useComposerAttachments(undefined)

  const attachments = useMemo(() => {
    if (!seed || seedDropped) return added
    // Only a media attachment has bytes to preview; anything else shows as a plain chip.
    const previewUrl =
      seed.kind === 'image' || seed.kind === 'video' || seed.kind === 'audio'
        ? mediaSrc(seed)
        : undefined
    return [{ id: SEED_ID, attachment: seed, ...(previewUrl ? { previewUrl } : {}) }, ...added]
  }, [added, seed, seedDropped])

  const remove = useCallback(
    (id: string) => {
      if (id === SEED_ID) {
        setSeedDropped(true)
        return
      }
      removeAttachment(id)
    },
    [removeAttachment],
  )

  const reset = useCallback(() => {
    setNote('')
    setSeedDropped(false)
    clearAttachments()
  }, [clearAttachments])

  // Moving to another target without cancelling used to carry the half-written note (and any
  // files) onto it, so the next comment could quietly describe the previous thing.
  const [seenTarget, setSeenTarget] = useState(target)
  if (seenTarget !== target) {
    setSeenTarget(target)
    reset()
  }

  return {
    note,
    setNote,
    attachments,
    gate,
    addFiles: (files) => void addFiles(files),
    removeAttachment: remove,
    reset,
  }
}
