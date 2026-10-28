import { useRef, type ReactNode } from 'react'
import { Paperclip, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Textarea } from '@localixai/kit/textarea'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { matchesChord, withChordHint } from '@/shared/lib/keybindings'
import { AttachmentTray } from '@/shared/ui/attachments/AttachmentTray'
import { acceptAttribute } from '@/shared/lib/attachment-policy'
import type { CommentDraft } from './useCommentDraft'

/** Ref for a field that takes the keyboard when it appears (the one thing `autoFocus` did). */
export const focusOnMount = (element: HTMLTextAreaElement | null) => element?.focus()

/**
 * Writing one review comment: what it points at, what it carries, what it says, and the two
 * actions that end it. The same window on every surface.
 *
 * The plan and the preview each had their own: the same textarea, the same Cancel/Add pair, the
 * same ⌘↵ and Escape — but only the preview could attach a file, and only the preview showed
 * what was already attached. Two copies is how the preview ended up with no card at all for a
 * while, attaching picks with a canned sentence. Now a text comment can carry a screenshot for
 * the same reason a preview comment can: it is the same act.
 *
 * What the comment POINTS AT belongs to the surface — a quoted sentence, a picked element's
 * label — and goes in `subject`. Placement and material belong to {@link AnchoredCommentCard}.
 */
export function CommentDraftCard({
  label,
  subject,
  draft,
  onSubmit,
  onCancel,
  submitLabel = 'Add comment',
  /**
   * Whether a comment with no words is worth attaching. True where the target itself carries the
   * message — a picked element arrives with its selector, source and (when the page could render
   * it) a screenshot, and "look at this" is a complete observation; false for prose, where a quote
   * with no note says nothing. It used to require the screenshot too, so an element the page could
   * not render left a card whose only button stayed disabled.
   */
  allowEmpty = false,
  /** Withdraw an existing comment — offered when one is reopened to edit. */
  onDelete,
  /**
   * Whether the comment can carry files. False where the comment is stored somewhere that keeps
   * only text (a plan's server-side comments): offering Attach there would accept a file and then
   * silently drop it.
   */
  attachments = true,
  busy = false,
  className,
  style,
}: {
  /** Accessible name of the form (what is being commented on). */
  label: string
  subject?: ReactNode
  draft: CommentDraft
  onSubmit: () => void
  onCancel: () => void
  submitLabel?: string
  allowEmpty?: boolean
  attachments?: boolean
  busy?: boolean
  onDelete?: () => void
  className?: string
  /** Placement is the surface's business — this only forwards it. */
  style?: React.CSSProperties
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasEvidence = draft.attachments.length > 0
  const canSubmit = !busy && (draft.note.trim().length > 0 || allowEmpty)

  return (
    <form
      aria-label={label}
      className={cn('flex flex-col', className)}
      style={style}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }}
    >
      {subject}
      {hasEvidence && (
        <div className="-mx-2 -mt-1 mb-0.5">
          <AttachmentTray attachments={draft.attachments} onRemove={draft.removeAttachment} />
        </div>
      )}
      <Textarea
        ref={focusOnMount}
        aria-label="Comment"
        aria-keyshortcuts="Control+Enter Meta+Enter"
        value={draft.note}
        onChange={(event) => draft.setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (matchesChord(event, 'mod+enter') && canSubmit) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder="Leave a comment"
        rows={2}
        size="xl"
        className="max-h-40 min-h-14 overflow-y-auto"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptAttribute(draft.gate)}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length) draft.addFiles(files)
          event.target.value = ''
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-0.5">
          {onDelete && (
            <IconButton
              size="sm"
              onClick={onDelete}
              aria-label="Delete comment"
              tooltip="Delete comment"
              className="text-text-soft hover:text-status-error"
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          )}
          {attachments ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files or images"
              className="text-text-soft hover:text-foreground"
            >
              <Paperclip data-icon="inline-start" aria-hidden /> Attach
            </Button>
          ) : (
            <span />
          )}
        </div>
        <div role="group" aria-label="Comment actions" className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="mono"
            size="sm"
            disabled={!canSubmit}
            title={withChordHint(submitLabel, 'mod+enter')}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}
