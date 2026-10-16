import { useRef, useState } from 'react'

import type { MessageBinding } from '@/shared/api/contracts'
import { toast } from '@/shared/lib/notify'
import { forgetSubmittedReviewComments } from '@/shared/lib/reviewCommentBinding'

import type { useContextRefs } from '../../model/useContextRefs'

/**
 * The composer's submit. A send is not instant — the context-ref budget preflight is async —
 * and two defects live in that gap: a second Enter would start a second preflight and send the
 * draft twice, and a ref pinned WHILE the preflight ran belongs to the next draft, so clearing
 * every pin afterwards would silently drop it. So one preflight at a time (`preparingSendRef`,
 * mirrored into state for the button), and only the pins of the submitted snapshot are cleared.
 */
export function usePromptSend(input: {
  prompt: string
  ctxRefs: ReturnType<typeof useContextRefs>
  onSend: (textOverride?: string, bindings?: MessageBinding[]) => void
  isEditing: boolean
  onSubmitEdit?: (text: string) => boolean
  /** The `/open` command owns Enter while it is active. */
  openCommandActive: boolean
  submitOpenResource: () => void
  /** A command the composer completes itself (`/model`'s steps); true when it handled the send. */
  submitClientCommand?: () => boolean
}) {
  const { prompt, ctxRefs, onSend, isEditing, onSubmitEdit } = input
  const [preparingSend, setPreparingSend] = useState(false)
  const preparingSendRef = useRef(false)

  const handleSend = () => {
    if (input.openCommandActive) {
      input.submitOpenResource()
      return
    }
    if (input.submitClientCommand?.()) return
    // Editing a past message: submit UPDATES it (reusing the existing
    // update-message handler) instead of sending a new message. Empty/unchanged
    // is handled by the parent (treated as a cancel — the UI never sends an
    // empty edit). Context-ref budget preflight is skipped: a text edit forks the
    // same message, it doesn't carry the composer's pinned refs.
    if (isEditing && onSubmitEdit) {
      if (onSubmitEdit(prompt)) {
        return
      }
    }
    if (preparingSendRef.current) return
    preparingSendRef.current = true
    setPreparingSend(true)
    const submittedPinnedKeys = ctxRefs.pinnedRefs.map((ref) => ref.key)
    void (async () => {
      try {
        // Budget preflight only — the text goes out UNCHANGED (tokens in place);
        // the refs ride as a structured field and expand server-side into
        // model-only binding contributions (quiet linking, no transcript noise).
        const refs = await ctxRefs.refsForSend(prompt)
        if (refs === null) {
          toast.error('Could not send the message', {
            description:
              'Its context references are too large for the model window. Remove some or narrow their line ranges.',
          })
          return
        }
        // Context is a first-class binding, not synthetic user prose.
        onSend(prompt, refs.length > 0 ? refs : undefined)
        ctxRefs.clearPinnedRefs(submittedPinnedKeys)
        // A review comment that has been delivered stops marking its target: the commented
        // sentence and the preview element are no longer awaiting feedback.
        forgetSubmittedReviewComments(submittedPinnedKeys)
      } finally {
        preparingSendRef.current = false
        setPreparingSend(false)
      }
    })()
  }

  return { handleSend, preparingSend }
}
