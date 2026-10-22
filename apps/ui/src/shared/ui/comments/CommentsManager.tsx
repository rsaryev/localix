import { Send, X, MessageSquare } from 'lucide-react'
import { highlightScript } from '@/shared/ui/code-block/highlightCode'
import type { CommentActionContribution } from '@localixai/plugin-sdk/ui'
import { useCommentActions } from '@/shared/contrib/commentActions'
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import { ActionPill } from '@localixai/kit/action-pill'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { CODE_VIEWER_HIGHLIGHT } from '@/shared/ui/code-block/sugarHighTheme'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { groupComments, type Comment } from '@localixai/plugin-sdk/ui/comments'

export interface CommentsManagerProps {
  /** Scope-filtered comments (e.g. the active session's). */
  comments: Comment[]
  submitting?: boolean
  /** Label for the submit action (default "Send"). */
  submitLabel?: string
  onRemove: (id: string) => void
  onClear: () => void
  onSubmit?: () => void
  /**
   * Sending the batch is the surface's expected next step (a plan with open comments): the count
   * pill that leads to it and the submit inside carry the kit's `recommended` mark.
   */
  recommendSubmit?: boolean
  /** Optional: jump to a comment's target (e.g. open its file at the line). */
  onNavigate?: (comment: Comment) => void
  /**
   * Run a contributed comment action (`host.commentActions`) on this batch. Without it the row
   * offers only "Send": an action needs the batch built from this surface's comments, and a
   * surface that cannot build one must not show a button that would do nothing.
   */
  onAction?: (action: CommentActionContribution) => void
  /** The id of the action in flight — its button reads as busy and the others wait. */
  runningAction?: string | null
  /**
   * Give the trigger pill the floating material itself. For the surfaces that place it ALONE over
   * pane content; inside a `FloatingActionGroup` or a `PanelHeader` the ground already exists and
   * a second coat is what made these pills read as black chips.
   */
  elevated?: boolean
  /** Explain a surface's retained history independently of its outgoing context. */
  description?: string
}

/**
 * Standardized accumulate → manage → submit UI for review comments. Surface-agnostic
 * (file editor, prose text, website element picker): a compact count pill opening a
 * minimalist popover — each row is the syntax-highlighted target line (click to jump)
 * plus the note and a remove ✕. No inline editing (re-add to change). Pair with
 * `useComments` (`shared/lib/comments`).
 */
export function CommentsManager({
  comments,
  submitting,
  submitLabel = 'Send',
  onRemove,
  onClear,
  onSubmit,
  recommendSubmit = false,
  onNavigate,
  onAction,
  runningAction = null,
  elevated,
  description,
}: CommentsManagerProps) {
  const actions = useCommentActions()
  if (comments.length === 0) return null
  const groups = groupComments(comments)
  // Only while there is a submit to suggest, and not while it is already being sent.
  const recommended = recommendSubmit && !!onSubmit && !submitting

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Always `active`: a count pill only exists when there is something to show. */}
        <ActionPill
          aria-label={`Review ${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`}
          active
          elevated={elevated}
          recommended={recommended}
        >
          <MessageSquare className="size-3" />
          {comments.length}
        </ActionPill>
      </PopoverTrigger>
      <PopoverContent layout="structured" align="end" className="w-[min(360px,calc(100vw-2rem))]">
        <PopoverHeader
          actionsLabel="Comment batch actions"
          actions={
            <>
              <Button variant="ghost" size="xs" onClick={onClear} className="text-text-faint">
                Clear
              </Button>
              {onAction &&
                actions.map((action) => (
                  <Button
                    key={action.id}
                    variant="outline"
                    size="xs"
                    onClick={() => onAction(action)}
                    disabled={runningAction !== null}
                    title={action.title}
                    className="text-text-soft"
                  >
                    <action.Icon />
                    {runningAction === action.id ? `${action.label}…` : action.label}
                  </Button>
                ))}
              {onSubmit && (
                <Button
                  variant="mono"
                  size="xs"
                  onClick={onSubmit}
                  disabled={submitting}
                  recommended={recommended}
                >
                  <Send />
                  {submitting ? 'Sending…' : submitLabel}
                </Button>
              )}
            </>
          }
        >
          <PopoverTitle className="text-text-soft">
            {comments.length} comment{comments.length === 1 ? '' : 's'}
          </PopoverTitle>
        </PopoverHeader>
        <PopoverBody className="max-h-[min(420px,60vh)] p-0">
          {description && <p className="px-2.5 py-2 text-xs text-text-soft">{description}</p>}
          {groups.map((g) => (
            <div key={g.groupId}>
              {/* Popover-hue, not `bg-surface-raised`: raised mixes from a darker ground than the
                  frosted popover, so under glass this sticky label read as an abrupt black strip.
                  `bg-popover` restates the panel's own material; the blur keeps the rows sliding
                  under it illegible (the popover already pays for its frost). */}
              <div className="sticky top-0 z-(--z-sticky) truncate bg-popover backdrop-blur px-2.5 py-1 text-2xs font-medium text-text-faint">
                {g.groupLabel}
              </div>
              {g.items.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-start gap-1.5 px-2.5 py-1.5 transition-colors hover:bg-surface-hover/40"
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onNavigate?.(c)}
                      disabled={!onNavigate}
                      title={onNavigate ? `Go to ${c.anchor.label}` : c.anchor.label}
                      className="flex w-full items-baseline gap-2 text-left enabled:cursor-pointer disabled:cursor-default"
                    >
                      <span className="shrink-0 text-2xs tabular-nums text-text-faint group-hover:text-text-soft">
                        {c.anchor.label}
                      </span>
                      {c.anchor.context && (
                        <code
                          className={cn(
                            'min-w-0 flex-1 truncate text-2xs [font-family:JetBrains_Mono,ui-monospace,monospace]',
                            CODE_VIEWER_HIGHLIGHT,
                          )}
                          dangerouslySetInnerHTML={{ __html: highlightScript(c.anchor.context) }}
                        />
                      )}
                    </button>
                    {c.body && (
                      <div className="mt-0.5 text-xs leading-snug text-foreground">{c.body}</div>
                    )}
                  </div>
                  <IconButton
                    size="xs"
                    tone="danger"
                    aria-label="Remove comment"
                    tooltip="Remove comment"
                    onClick={() => onRemove(c.id)}
                    className="lx-hover-actions mt-0.5 shrink-0 text-text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X />
                  </IconButton>
                </div>
              ))}
            </div>
          ))}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
