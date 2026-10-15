import type { ReactNode } from 'react'
import { Check, Code, Columns2, Copy, Eye, Globe, MoreHorizontal, Save } from 'lucide-react'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'
import { formatChordText } from '@/shared/lib/keybindings'
import { CommentsManager } from '@/shared/ui/comments/CommentsManager'
import type { CommentActionContribution } from '@localixai/plugin-sdk/ui'
import type { Comment } from '@localixai/plugin-sdk/ui/comments'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { COPIED_FEEDBACK_SHORT_MS } from '@/shared/lib/timings'

/**
 * Floating actions covered code and caught clicks intended for the editor. This row
 * reserves space above the content instead; an overflow menu keeps
 * narrow panes usable without wrapping controls over the first lines.
 */
export function FileEditorToolbar({
  dirty,
  saving,
  comments,
  sendingComments,
  runningCommentAction,
  onRemoveComment,
  onClearComments,
  onSendComments,
  onNavigateComment,
  onCommentAction,
  markdownFile,
  previewMarkdown,
  onTogglePreview,
  splitView,
  onToggleSplit,
  onOpenHtmlPreview,
  onSave,
  copyText,
  children,
}: {
  dirty: boolean
  saving: boolean
  comments: Comment[]
  sendingComments: boolean
  runningCommentAction: string | null
  onRemoveComment: (id: string) => void
  onClearComments: () => void
  onSendComments: () => void
  onNavigateComment: (c: Comment) => void
  onCommentAction: (action: CommentActionContribution) => void
  markdownFile: boolean
  previewMarkdown: boolean
  onTogglePreview: () => void
  /** Markdown split view (editor | rendered preview, scroll-synced). Undefined → hide the toggle. */
  splitView?: boolean
  onToggleSplit?: () => void
  /** Present for HTML files: auto-serve the file and open it in the Preview tab. */
  onOpenHtmlPreview?: () => void
  onSave: () => void
  copyText: string
  children?: ReactNode
}) {
  const { copied, copy } = useCopied(COPIED_FEEDBACK_SHORT_MS)
  return (
    <WorkbenchToolbar aria-label="File editor actions" density="slim" className="pl-0">
      <div className="min-w-0 flex-1">{children}</div>
      <WorkbenchToolbarSection align="end" spacing="compact">
        {dirty && (
          <span
            title="Unsaved changes"
            className="mr-0.5 size-1.5 rounded-full bg-status-warning"
          />
        )}
        <CommentsManager
          comments={comments}
          submitting={sendingComments}
          submitLabel="Add to message"
          onRemove={onRemoveComment}
          onClear={onClearComments}
          onSubmit={onSendComments}
          onNavigate={onNavigateComment}
          onAction={onCommentAction}
          runningAction={runningCommentAction}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="xs" aria-label="File actions" tooltip="File actions">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="File actions">
            <MenuEntries
              family="dropdown"
              entries={[
                {
                  id: 'save',
                  label: saving ? 'Saving…' : 'Save',
                  icon: Save,
                  hint: formatChordText('mod+s'),
                  disabled: !dirty || saving,
                  onSelect: onSave,
                },
                {
                  id: 'copy',
                  label: copied ? 'Copied' : 'Copy file contents',
                  icon: copied ? Check : Copy,
                  onSelect: () => void copy(copyText),
                },
                ...(markdownFile || onOpenHtmlPreview ? [{ separator: true as const }] : []),
                ...(markdownFile && !splitView
                  ? [
                      {
                        id: 'preview',
                        label: previewMarkdown ? 'Edit source' : 'Preview markdown',
                        icon: previewMarkdown ? Code : Eye,
                        onSelect: onTogglePreview,
                      },
                    ]
                  : []),
                ...(markdownFile && onToggleSplit
                  ? [
                      {
                        id: 'split',
                        label: 'Split preview',
                        icon: Columns2,
                        onSelect: onToggleSplit,
                      },
                    ]
                  : []),
                ...(onOpenHtmlPreview
                  ? [
                      {
                        id: 'html-preview',
                        label: 'Preview in browser panel',
                        icon: Globe,
                        onSelect: onOpenHtmlPreview,
                      },
                    ]
                  : []),
              ]}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}
