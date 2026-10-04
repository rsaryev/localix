import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useReviewComments } from '@/shared/ui/comments/useReviewComments'
import { AnchoredCommentCard } from '@/shared/ui/comments/AnchoredCommentCard'
import { useCommentDraft } from '@/shared/ui/comments/useCommentDraft'
import { previewCommentScope } from '../model/previewCommentScope'
import { PreviewCommentSubject } from './PreviewCommentSubject'
import { usePreviewFeedbackCapture } from './usePreviewFeedbackCapture'
import { buildPreviewCommentsMessage } from '@localixai/visual-feedback/host'
import type { VfCapture } from '@localixai/visual-feedback/protocol'
import { previewPickMode, quickAddText } from '../model/previewSelection'
import type { VisualFeedbackBridge } from './useVisualFeedback'

export interface VisualFeedbackLayerProps {
  /** False while the keep-alive preview body is mounted but not visible. */
  active?: boolean
  bridge: VisualFeedbackBridge
  sessionId: string | null
  url: string
  servedFile?: string
}

/**
 * Picks in a live preview, attached as review comments — the shared mechanism every review
 * surface uses ({@link useReviewComments}), so this layer owns only the geometry and the
 * capture, never a delivery path of its own.
 *
 * What it puts on the page is one tint per commented element and nothing else. The pane used to
 * carry a floating "N comments" popover — a second copy of the list the composer already shows —
 * and numbered pins that competed with the very layout being reviewed. The list lives in the
 * composer's attached context; the page only says which parts of it have been spoken about.
 */
export function VisualFeedbackLayer({
  active = true,
  bridge,
  sessionId,
  url,
  servedFile,
}: VisualFeedbackLayerProps) {
  // Scope comments to THIS preview (by origin), not just the session — otherwise two
  // open preview tabs in one session would share a comment list and submit together
  // under whichever header is active.
  const review = useReviewComments(previewCommentScope(sessionId, url), sessionId)

  const [bodySize, setBodySize] = useState({ w: 0, h: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const captureResult = usePreviewFeedbackCapture(bridge.pending?.capture, bridge.captureElement)
  const draft = useCommentDraft(
    captureResult.asset,
    bridge.pending?.capture.selector || bridge.pending?.capture.summary,
  )
  const attachedCaptures = useRef(new WeakSet<VfCapture>())

  // Track the preview body size (state, not a ref-read-in-render) so the composer
  // can clamp within it.
  useEffect(() => {
    if (!active) return
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBodySize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBodySize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [active])

  // One pick becomes one review comment: stored as the anchor this surface knows how to
  // reveal, staged as one atomic context binding whose screenshot is nested evidence — so the
  // composer budgets, shows and removes the note and its picture together.
  const attach = useCallback(
    (capture: VfCapture, note: string) => {
      if (!sessionId) return
      const body = note.trim() || quickAddText(capture) || 'Look at this element.'
      review.add({
        label: `Preview: ${capture.summary}`,
        body,
        content: buildPreviewCommentsMessage([{ capture, note: body }], {
          servedFile,
          url,
          viewport: { width: bodySize.w, height: bodySize.h },
        }),
        assets: draft.attachments.map((item) => item.attachment),
        anchor: {
          kind: 'element',
          targetId:
            capture.selector ||
            `${capture.kind}@${Math.round(capture.rect.x)},${Math.round(capture.rect.y)}`,
          label: capture.summary,
          groupId: url,
          groupLabel: servedFile ?? 'Preview',
          context: capture.text,
          locator: { selector: capture.selector, capture },
        },
      })
      draft.reset()
      bridge.clearPending()
    },
    [bodySize, bridge, draft, review, servedFile, sessionId, url],
  )

  // What already carries a comment, marked on the page itself — the preview's answer to a
  // text surface's highlighted sentence. Quiet by design: a tint, no numbers, nothing to click.
  const markedSelectors = useMemo(
    () =>
      review.comments.flatMap((comment) => {
        const selector = comment.anchor.locator?.selector
        return typeof selector === 'string' && selector ? [selector] : []
      }),
    [review.comments],
  )
  const { setMarks } = bridge
  useEffect(() => {
    setMarks(markedSelectors)
  }, [markedSelectors, setMarks])

  // Selecting TEXT is its own gesture: the words are the comment, so it attaches on the spot
  // rather than opening a card to retype what was just highlighted.
  useEffect(() => {
    const p = bridge.pending
    if (!p || !sessionId || previewPickMode(p.capture) !== 'quick-add') return
    if (attachedCaptures.current.has(p.capture)) return
    attachedCaptures.current.add(p.capture)
    attach(p.capture, '')
  }, [bridge.pending, sessionId, attach])

  // An ELEMENT pick opens the card, so the observation can carry what is actually wrong with
  // it. The note stays optional: the screenshot beside it already says "this one".
  const pending = bridge.pending
  const composing = pending && previewPickMode(pending.capture) !== 'quick-add'

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-(--z-sticky) overflow-hidden"
      onKeyDownCapture={(event) => {
        // Escape inside the iframe is relayed by the probe. This bounded handler
        // covers the native host composer before its textarea only dismisses the card.
        if (active && bridge.mode === 'comment' && event.key === 'Escape') {
          event.preventDefault()
          bridge.setMode('off')
        }
      }}
    >
      {composing && pending && (
        <AnchoredCommentCard
          key={pending.capture.selector || pending.capture.summary}
          active={active}
          anchor={pending.rect}
          bounds={{ width: bodySize.w, height: bodySize.h }}
          // Floating over the person's own page, whose colours we do not know: the panel is
          // opaque here, where over the app's chrome it frosts.
          material="foreign"
          label={`Comment on ${pending.capture.summary}`}
          subject={<PreviewCommentSubject capture={pending.capture} />}
          draft={draft}
          // The pick carries its own screenshot, so "this element, here" is already a complete
          // observation — a note sharpens it rather than being the whole of it.
          allowEmpty
          busy={!captureResult.ready}
          submitLabel={captureResult.ready ? 'Attach feedback' : 'Capturing…'}
          onSubmit={() => attach(pending.capture, draft.note)}
          onCancel={() => {
            draft.reset()
            bridge.clearPending()
          }}
        />
      )}
    </div>
  )
}
