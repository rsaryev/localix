import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MessageSquare, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'

import { expandSelectionToSentence, findQuoteRange } from '@/shared/lib/text-selection'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Textarea } from '@localixai/kit/textarea'
import { POPOVER_MATERIAL, POPOVER_SURFACE } from '@localixai/kit/popover-surface'
import { AnchoredCommentCard } from './AnchoredCommentCard'
import { focusOnMount } from './CommentDraftCard'
import { useCommentDraft } from './useCommentDraft'
import type { MessageAttachment } from '@/shared/api/contracts'
import { matchesChord, withChordHint } from '@/shared/lib/keybindings'

export interface AnchoredTextComment {
  id: string
  quote: string
  note: string
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

interface Anchor {
  id: string
  rects: Rect[]
  top: number
}

interface Pending {
  quote: string
  top: number
  left: number
}

export interface TextCommentLayerProps {
  children: ReactNode
  comments: readonly AnchoredTextComment[]
  onAdd: (quote: string, note: string, assets: MessageAttachment[]) => void
  onUpdate: (id: string, note: string) => void
  onRemove: (id: string) => void
  /** Suspended surfaces keep their DOM but avoid observers and selection listeners. */
  active?: boolean
  /** Show the comments, but take no new ones and offer no edit or delete (a decided version). */
  readOnly?: boolean
  /** Whether a new comment may carry files; see `CommentDraftCard`. */
  attachments?: boolean
  className?: string
  contentClassName?: string
}

/**
 * Surface-agnostic comments for arbitrary prose. The child can be markdown, a lesson,
 * documentation, or any other rendered text: selection, sentence expansion, highlights,
 * edit/delete cards, and positioning are owned here; persistence stays with the caller.
 */
export function TextCommentLayer({
  children,
  comments,
  onAdd,
  onUpdate,
  onRemove,
  active = true,
  readOnly = false,
  attachments = true,
  className,
  contentClassName,
}: TextCommentLayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const proseRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [composing, setComposing] = useState(false)
  const [anchors, setAnchors] = useState<Anchor[]>([])
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const recompute = useCallback(() => {
    const wrap = wrapRef.current
    const prose = proseRef.current
    if (!wrap || !prose) return
    const base = wrap.getBoundingClientRect()
    const scrollTop = wrap.scrollTop
    const scrollLeft = wrap.scrollLeft
    const next: Anchor[] = []
    for (const comment of comments) {
      const range = findQuoteRange(prose, comment.quote)
      if (!range) continue
      const rects = Array.from(range.getClientRects()).map((rect) => ({
        top: rect.top - base.top + scrollTop,
        left: rect.left - base.left + scrollLeft,
        width: rect.width,
        height: rect.height,
      }))
      if (rects.length === 0) continue
      next.push({
        id: comment.id,
        rects,
        top: Math.min(...rects.map((rect) => rect.top)),
      })
    }
    setAnchors(next)
    // The card is placed in CONTENT coordinates inside this scroller, so what it must stay
    // inside is the scrolled content box, not the visible window onto it.
    setBounds({ width: wrap.clientWidth, height: Math.max(wrap.scrollHeight, wrap.clientHeight) })
  }, [comments])

  useLayoutEffect(() => {
    if (!active) return
    recompute()
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(recompute)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [active, children, recompute])

  const captureSelection = useCallback(() => {
    if (!active || composing || readOnly) return
    const wrap = wrapRef.current
    const prose = proseRef.current
    if (!wrap || !prose) return
    const expanded = expandSelectionToSentence(prose)
    if (!expanded) {
      setPending(null)
      return
    }
    const base = wrap.getBoundingClientRect()
    const half = 160
    const pad = 8
    const rawLeft = expanded.rect.left - base.left + wrap.scrollLeft + expanded.rect.width / 2
    const left = Math.max(half + pad, Math.min(rawLeft, base.width - half - pad))
    setPending({
      quote: expanded.quote,
      top: expanded.rect.bottom - base.top + wrap.scrollTop + 6,
      left,
    })
    setOpenId(null)
  }, [active, composing, readOnly])

  useEffect(() => {
    if (!active) return
    const onSelectionChange = () => {
      if (composing) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) setPending(null)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [active, composing])

  // The content is not a control: it only reports where a selection ended, so those listeners
  // are attached to the element itself rather than declared as interactions on a static node.
  useEffect(() => {
    const prose = proseRef.current
    if (!prose) return
    prose.addEventListener('mouseup', captureSelection)
    prose.addEventListener('keyup', captureSelection)
    return () => {
      prose.removeEventListener('mouseup', captureSelection)
      prose.removeEventListener('keyup', captureSelection)
    }
  }, [captureSelection])

  // The same draft the preview writes into: a note, plus anything attached to it. A quoted
  // sentence seeds no evidence of its own, so the seed is empty and the Attach control is what
  // puts a screenshot or a file on a text comment.
  const newDraft = useCommentDraft(undefined, pending?.quote)

  const submitNew = useCallback(() => {
    if (!pending || !newDraft.note.trim()) return
    onAdd(
      pending.quote,
      newDraft.note.trim(),
      newDraft.attachments.map((item) => item.attachment),
    )
    setComposing(false)
    setPending(null)
    newDraft.reset()
    window.getSelection()?.removeAllRanges()
  }, [newDraft, onAdd, pending])

  const cancelNew = useCallback(() => {
    setComposing(false)
    setPending(null)
    newDraft.reset()
  }, [newDraft])

  return (
    <div
      ref={wrapRef}
      className={cn('relative min-h-0 overflow-auto scrollbar-thin', className)}
      data-scrollable
    >
      <div ref={proseRef} className={contentClassName}>
        {children}
      </div>

      {anchors.map((anchor) =>
        anchor.rects.map((rect, index) => (
          <button
            key={`${anchor.id}-${index}`}
            type="button"
            aria-label="Show comment"
            onClick={() => {
              setOpenId((current) => (current === anchor.id ? null : anchor.id))
              setEditId(null)
            }}
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
            className="absolute z-(--z-raised) cursor-pointer rounded-sm border-0 bg-status-info/22 p-0 transition-colors hover:bg-status-info/34"
          />
        )),
      )}

      {anchors.map((anchor) => (
        <IconButton
          key={`marker-${anchor.id}`}
          onClick={() => {
            setOpenId((current) => (current === anchor.id ? null : anchor.id))
            setEditId(null)
          }}
          style={{ top: anchor.top - 2, right: 0 }}
          size="xs"
          // Floating-surface recipe (alpha + blur), not a bare `bg-surface-raised`: raised mixes
          // from a darker ground than the document it floats over, so the marker read as a black dot.
          className={cn(
            POPOVER_MATERIAL,
            'absolute z-(--z-controls) rounded-full border border-border text-text-soft',
          )}
          aria-label="Show comment"
        >
          <MessageSquare className="size-3.5" />
        </IconButton>
      ))}

      {(() => {
        if (!openId) return null
        const anchor = anchors.find((item) => item.id === openId)
        const comment = comments.find((item) => item.id === openId)
        if (!anchor || !comment) return null
        const editing = editId === openId
        return (
          <div
            style={{
              top: anchor.rects[0]!.top + anchor.rects[0]!.height + 6,
              left: Math.min(anchor.rects[0]!.left, 24),
            }}
            className={cn(
              POPOVER_SURFACE,
              'absolute z-(--z-sticky) w-80 max-w-[calc(100%-12px)] p-2',
            )}
          >
            <div
              className="mb-1.5 line-clamp-2 rounded-md bg-surface-hover px-2 py-1 text-2xs italic text-text-soft"
              title={comment.quote}
            >
              “{comment.quote}”
            </div>
            {editing ? (
              <form
                aria-label="Edit comment"
                onSubmit={(event) => {
                  event.preventDefault()
                  const next = draft.trim()
                  if (!next) return
                  onUpdate(openId, next)
                  setEditId(null)
                }}
              >
                <Textarea
                  ref={focusOnMount}
                  aria-label="Comment"
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditId(null)
                    }
                    if (matchesChord(event, 'mod+enter') && draft.trim()) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  rows={2}
                  size="xl"
                  className="min-h-14 max-h-40 overflow-y-auto"
                />
                <div
                  role="group"
                  aria-label="Edit comment actions"
                  className="mt-1.5 flex items-center justify-end gap-1.5"
                >
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditId(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="mono"
                    size="sm"
                    disabled={!draft.trim()}
                    title={withChordHint('Save comment', 'mod+enter')}
                  >
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="whitespace-pre-wrap px-2 py-1 text-sm text-foreground">
                  {comment.note}
                </div>
                <div
                  className={cn(
                    'mt-1 items-center justify-end gap-1',
                    readOnly ? 'hidden' : 'flex',
                  )}
                >
                  <IconButton
                    size="sm"
                    aria-label="Edit comment"
                    onClick={() => {
                      setEditId(openId)
                      setDraft(comment.note)
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    tone="danger"
                    aria-label="Delete comment"
                    onClick={() => {
                      onRemove(openId)
                      setOpenId(null)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {pending && !composing ? (
        <Button
          type="button"
          variant="mono"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setComposing(true)}
          style={{ top: pending.top, left: pending.left }}
          className="absolute z-(--z-overlay) -translate-x-1/2 gap-1.5 rounded-md px-2.5 py-1.5"
        >
          <MessageSquarePlus data-icon="inline-start" aria-hidden />
          Comment
        </Button>
      ) : null}

      {pending && composing ? (
        <AnchoredCommentCard
          active={active}
          anchor={{ x: pending.left, y: pending.top }}
          bounds={bounds}
          align="center"
          width={320}
          label="Comment on selected text"
          attachments={attachments}
          draft={newDraft}
          onSubmit={submitNew}
          onCancel={cancelNew}
          subject={
            <div
              className="mb-1.5 line-clamp-2 rounded-md bg-surface-hover px-2 py-1 text-2xs italic text-text-soft"
              title={pending.quote}
            >
              “{pending.quote}”
            </div>
          }
        />
      ) : null}
    </div>
  )
}
