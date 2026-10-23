import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useComments, type Comment } from '@localixai/mini-app-sdk/ui/comments'
import { useReviewComments } from '@/shared/ui/comments/useReviewComments'
import { AnchoredCommentCard } from '@/shared/ui/comments/AnchoredCommentCard'
import { useCommentDraft } from '@/shared/ui/comments/useCommentDraft'
import { previewCommentScope } from '../model/previewCommentScope'
import { PreviewCommentSubject } from './PreviewCommentSubject'
import { usePreviewFeedbackCapture } from './usePreviewFeedbackCapture'
import { buildPreviewCommentsMessage } from '@localixai/visual-feedback/host'
import type { VfCapture, VfMark, VfRect } from '@localixai/visual-feedback/protocol'
import type { MessageAttachment } from '@/shared/api/contracts'
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

/** What a preview comment keeps beside its anchor, so it can be reopened and restaged as it was. */
interface PreviewLocator {
  selector: string
  capture: VfCapture
  assets?: MessageAttachment[]
}

const locatorOf = (comment: Comment) => comment.anchor.locator as PreviewLocator | undefined

/**
 * Picks in a live preview, kept as review comments — the shared mechanism every review surface
 * uses ({@link useReviewComments}), so this layer owns only the geometry, the capture and the
 * comment's life on the page.
 *
 * A comment's whole life happens where it was made. Picking an element opens a card; submitting
 * stages it as one chip in the composer and tints the element. Pointing at a tinted element names
 * the comment (`#2 “make it primary”`), and clicking it reopens the card to edit or delete it.
 * Removing the chip withdraws the comment and its tint; sending delivers it and clears both.
 * The page stays quiet in between: a tint per comment, no pins competing with the layout.
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

  // The comment reopened from the page, if any — edited in the same card a new one is written in.
  const opened = bridge.openedMark
  const editing = opened ? review.comments.find((c) => c.id === opened.id) : undefined
  const editingLocator = editing ? locatorOf(editing) : undefined

  const captureResult = usePreviewFeedbackCapture(bridge.pending?.capture, bridge.captureElement)
  const draft = useCommentDraft(
    editing ? editingLocator?.assets : captureResult.asset,
    editing
      ? `edit:${editing.id}`
      : bridge.pending?.capture.selector || bridge.pending?.capture.summary,
    editing?.body,
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

  const contentFor = useCallback(
    (capture: VfCapture, note: string) =>
      buildPreviewCommentsMessage([{ capture, note }], {
        servedFile,
        url,
        viewport: { width: bodySize.w, height: bodySize.h },
      }),
    [bodySize, servedFile, url],
  )

  // One pick becomes one review comment: stored as the anchor this surface knows how to
  // reveal, staged as one atomic context binding whose screenshot is nested evidence — so the
  // composer budgets, shows and removes the note and its picture together.
  const attach = useCallback(
    (capture: VfCapture, note: string, assets: MessageAttachment[]) => {
      if (!sessionId) return
      const body = note.trim() || quickAddText(capture) || 'Look at this element.'
      review.add({
        label: `Preview: ${capture.summary}`,
        body,
        content: contentFor(capture, body),
        assets,
        anchor: {
          kind: 'element',
          targetId:
            capture.selector ||
            `${capture.kind}@${Math.round(capture.rect.x)},${Math.round(capture.rect.y)}`,
          label: capture.summary,
          groupId: url,
          groupLabel: servedFile ?? 'Preview',
          context: capture.text,
          locator: { selector: capture.selector, capture, assets } satisfies PreviewLocator,
        },
      })
      draft.reset()
      bridge.clearPending()
    },
    [bridge, contentFor, draft, review, servedFile, sessionId, url],
  )

  // An edited comment refreshes its chip in place: same token, new note and evidence.
  const saveEdit = useCallback(
    (comment: Comment, locator: PreviewLocator) => {
      const body = draft.note.trim() || quickAddText(locator.capture) || 'Look at this element.'
      const assets = draft.attachments.map((item) => item.attachment)
      // The store keeps the anchor with the note, so a later edit starts from what was saved.
      useComments.setState((s) => ({
        comments: s.comments.map((c) =>
          c.id === comment.id
            ? { ...c, body, anchor: { ...c.anchor, locator: { ...locator, assets } } }
            : c,
        ),
      }))
      review.restage(comment.id, {
        label: `Preview: ${locator.capture.summary}`,
        body,
        content: contentFor(locator.capture, body),
        assets,
      })
      draft.reset()
      bridge.clearOpenedMark()
    },
    [bridge, contentFor, draft, review],
  )

  // What already carries a comment, marked on the page itself: a tint that names the comment
  // when pointed at, numbered as the comments were made.
  const marks = useMemo<VfMark[]>(
    () =>
      review.comments.flatMap((comment, i) => {
        const selector = locatorOf(comment)?.selector
        return selector ? [{ id: comment.id, selector, index: i + 1, note: comment.body }] : []
      }),
    [review.comments],
  )
  const { setMarks } = bridge
  useEffect(() => {
    setMarks(marks)
  }, [marks, setMarks])

  // Selecting TEXT is its own gesture: the words are the comment, so it attaches on the spot
  // rather than opening a card to retype what was just highlighted.
  useEffect(() => {
    const p = bridge.pending
    if (!p || !sessionId || previewPickMode(p.capture) !== 'quick-add') return
    if (attachedCaptures.current.has(p.capture)) return
    attachedCaptures.current.add(p.capture)
    attach(p.capture, '', [])
  }, [bridge.pending, sessionId, attach])

  // A comment withdrawn elsewhere (its chip removed, the message sent) closes its open card.
  useEffect(() => {
    if (opened && !editing) bridge.clearOpenedMark()
  }, [bridge, editing, opened])

  // An ELEMENT pick opens the card, so the observation can carry what is actually wrong with
  // it. The note stays optional: the selector, source and screenshot already say "this one".
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
      {editing && editingLocator && opened && (
        <CommentCard
          key={`edit:${editing.id}`}
          active={active}
          anchor={opened.rect}
          bounds={bodySize}
          label={`Edit comment on ${editingLocator.capture.summary}`}
          subject={
            <PreviewCommentSubject
              capture={editingLocator.capture}
              index={review.comments.indexOf(editing) + 1}
            />
          }
          draft={draft}
          submitLabel="Save"
          onSubmit={() => saveEdit(editing, editingLocator)}
          onCancel={() => {
            draft.reset()
            bridge.clearOpenedMark()
          }}
          onDelete={() => {
            review.remove(editing.id)
            draft.reset()
            bridge.clearOpenedMark()
          }}
        />
      )}
      {!editing && composing && pending && (
        <CommentCard
          key={pending.capture.selector || pending.capture.summary}
          active={active}
          anchor={pending.rect}
          bounds={bodySize}
          label={`Comment on ${pending.capture.summary}`}
          subject={
            <PreviewCommentSubject
              capture={pending.capture}
              noScreenshot={captureResult.ready && Boolean(captureResult.failed)}
            />
          }
          draft={draft}
          busy={!captureResult.ready}
          submitLabel={captureResult.ready ? 'Attach feedback' : 'Capturing…'}
          onSubmit={() =>
            attach(
              pending.capture,
              draft.note,
              draft.attachments.map((item) => item.attachment),
            )
          }
          onCancel={() => {
            draft.reset()
            bridge.clearPending()
          }}
        />
      )}
    </div>
  )
}

/** The card over the person's own page, whose colours we do not know: opaque, never frosted. */
function CommentCard({
  anchor,
  bounds,
  ...card
}: Omit<
  React.ComponentProps<typeof AnchoredCommentCard>,
  'anchor' | 'bounds' | 'material' | 'allowEmpty'
> & {
  anchor: VfRect
  bounds: { w: number; h: number }
}) {
  return (
    <AnchoredCommentCard
      {...card}
      anchor={anchor}
      bounds={{ width: bounds.w, height: bounds.h }}
      material="foreign"
      // A picked element is a complete observation on its own — its selector, source and
      // (when the page could render it) screenshot say "this one"; a note sharpens it.
      allowEmpty
    />
  )
}
