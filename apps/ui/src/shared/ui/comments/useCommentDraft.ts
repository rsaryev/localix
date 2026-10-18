import { useCallback, useMemo, useState } from 'react'
import { useComposerAttachments } from '@/shared/lib/attachments/useComposerAttachments'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'
import type { MessageAttachment } from '@/shared/api/contracts'

/** The ids surface-provided evidence is staged under — removable like any other file. */
const SEED_PREFIX = 'comment-evidence'

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
  /** Evidence the surface captured with the target, or everything an edited comment carries. */
  seed: MessageAttachment | readonly MessageAttachment[] | undefined,
  /** Identity of the thing being commented on — a new one starts a clean draft. */
  target: string | undefined,
  /** The note a draft starts from: an existing comment's, when it is reopened to edit. */
  initialNote = '',
): CommentDraft {
  const [note, setNote] = useState(initialNote)
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set())
  const {
    attachments: added,
    gate,
    addFiles,
    removeAttachment,
    clearAttachments,
  } = useComposerAttachments(undefined)

  const attachments = useMemo(() => {
    const seeds: readonly MessageAttachment[] = !seed ? [] : 'kind' in seed ? [seed] : seed
    const offered = seeds.flatMap((attachment, i) => {
      const id = i === 0 ? SEED_PREFIX : `${SEED_PREFIX}-${i}`
      if (dropped.has(id)) return []
      // Only a media attachment has bytes to preview; anything else shows as a plain chip.
      const previewUrl =
        attachment.kind === 'image' || attachment.kind === 'video' || attachment.kind === 'audio'
          ? mediaSrc(attachment)
          : undefined
      return [{ id, attachment, ...(previewUrl ? { previewUrl } : {}) }]
    })
    return [...offered, ...added]
  }, [added, seed, dropped])

  const remove = useCallback(
    (id: string) => {
      if (id.startsWith(SEED_PREFIX)) {
        setDropped((prev) => new Set(prev).add(id))
        return
      }
      removeAttachment(id)
    },
    [removeAttachment],
  )

  const reset = useCallback(() => {
    setNote('')
    setDropped(new Set())
    clearAttachments()
  }, [clearAttachments])

  // Moving to another target without cancelling used to carry the half-written note (and any
  // files) onto it, so the next comment could quietly describe the previous thing.
  const [seenTarget, setSeenTarget] = useState(target)
  if (seenTarget !== target) {
    setSeenTarget(target)
    reset()
    setNote(initialNote)
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
