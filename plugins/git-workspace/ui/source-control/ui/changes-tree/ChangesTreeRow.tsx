import { memo } from 'react'
import { Check, ChevronRight, Plus, Minus, RotateCcw, FileText } from 'lucide-react'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'
import { fileIcon, folderIcon } from '@localixai/kit/file-icon'
import { indentGuideStyle } from '@localixai/kit/tree-navigation'
import { WorkbenchListRow } from '@localixai/kit/workbench-list-row'
import type { ChangeActions } from '../../model/changeActions'
import { statusMeta } from '../statusMeta'
import { BulkAction } from '../sourceControlParts'
import type { ChangesDirRow, ChangesFileRow } from './changesTreeRows'

/** Which index section a tree renders — drives the primary row action + which diff (staged vs working) opens. */
export type ChangeGroup = 'conflict' | 'staged' | 'unstaged'

/**
 * Small hover action on a row — the shared Source Control `BulkAction` icon
 * button; stops propagation so it doesn't open/toggle the row. Not a Tab stop:
 * the tree roves focus across rows only. File actions are also in the tree's
 * context menu; folder actions stay pointer affordances.
 */
function RowAction({
  title,
  onClick,
  children,
  danger,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <BulkAction
      title={title}
      danger={danger}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </BulkAction>
  )
}

interface FileRowProps {
  row: ChangesFileRow
  group: ChangeGroup
  active: boolean
  /** This row is the tree's one Tab stop (roving tabindex). */
  tabbable: boolean
  actions: ChangeActions
  onOpen: (file: RepoFileChange, staged: boolean) => void
}

/**
 * A clickable changed-file row: icon, name, hover actions, line delta, and a status letter.
 * Memoized: with stable `actions`/`onOpen` and a boolean `tabbable`, an unchanged row skips
 * rendering entirely when a sibling gains focus or the selection moves.
 */
export const FileRow = memo(function FileRow({
  row,
  group,
  active,
  tabbable,
  actions,
  onOpen,
}: FileRowProps) {
  const { file, depth, name } = row
  const staged = group === 'staged'
  const conflicted = group === 'conflict'
  const meta = statusMeta(file.status)
  const { Icon, color } = fileIcon(name)
  return (
    <WorkbenchListRow
      density="dense"
      active={active}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      aria-current={active ? 'true' : undefined}
      style={{ paddingLeft: depth * 12 + 8 + 16, ...indentGuideStyle(depth) }}
      className={[
        'group/row min-w-0 gap-1.5 rounded-none pr-2',
        active
          ? 'bg-surface-active font-medium text-foreground'
          : 'text-text-soft hover:bg-surface-hover focus-within:bg-surface-hover hover:text-foreground',
      ].join(' ')}
    >
      {/* Row is a plain container; the primary "open diff" action is a dedicated
          focusable button so the hover action buttons remain valid a11y siblings.
          It carries the data-tree-path + roving tabindex (arrow-key navigation). */}
      <button
        type="button"
        data-tree-path={file.path}
        data-tree-name={name}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onOpen(file, staged)}
        role="treeitem"
        aria-label={`${conflicted ? 'Resolve conflicts in' : staged ? 'Review staged changes in' : 'Review changes in'} ${file.path}`}
        aria-level={depth + 1}
        aria-selected={active}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none focus-ring"
      >
        <Icon className={`size-4 shrink-0 ${color}`} />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="lx-hover-actions flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {file.status !== 'deleted' && actions.onOpenFile && (
            <RowAction title="Open file" onClick={() => actions.onOpenFile?.(file)}>
              <FileText className="size-3.5" />
            </RowAction>
          )}
          {group === 'unstaged' && (
            <RowAction
              title="Discard changes"
              danger
              onClick={() => actions.onDiscard([file.path], name)}
            >
              <RotateCcw className="size-3" />
            </RowAction>
          )}
          {conflicted ? (
            <RowAction title="Stage as resolved" onClick={() => actions.onStage([file.path])}>
              <Check className="size-3.5" />
            </RowAction>
          ) : staged ? (
            <RowAction title="Unstage" onClick={() => actions.onUnstage([file.path])}>
              <Minus className="size-3.5" />
            </RowAction>
          ) : (
            <RowAction title="Stage" onClick={() => actions.onStage([file.path])}>
              <Plus className="size-3.5" />
            </RowAction>
          )}
        </span>
        {(file.insertions > 0 || file.deletions > 0) && (
          <span className="flex items-center gap-1 text-2xs tabular-nums">
            {file.insertions > 0 && <span className="text-status-success">+{file.insertions}</span>}
            {file.deletions > 0 && <span className="text-status-error">−{file.deletions}</span>}
          </span>
        )}
        <span className={`w-3 text-center text-2xs font-bold ${meta.color}`} title={meta.label}>
          {meta.letter}
        </span>
      </span>
    </WorkbenchListRow>
  )
})

interface DirRowProps {
  row: ChangesDirRow
  group: ChangeGroup
  tabbable: boolean
  actions: ChangeActions
  onToggle: (path: string) => void
}

/** A folder row: chevron + folder icon + name, with folder-wide hover actions outside Merge. */
export const DirRow = memo(function DirRow({
  row,
  group,
  tabbable,
  actions,
  onToggle,
}: DirRowProps) {
  const { path, name, depth, isOpen } = row
  const { Icon, color } = folderIcon(isOpen)
  return (
    <WorkbenchListRow
      density="dense"
      title={path}
      style={{ paddingLeft: depth * 12 + 8, ...indentGuideStyle(depth) }}
      className="group/row min-w-0 gap-1.5 rounded-none pr-2 text-foreground"
    >
      {/* Row is a plain container; the expand/collapse toggle is a dedicated
          focusable button so the folder action buttons remain valid a11y siblings.
          It carries the data-tree-path + roving tabindex (arrow-key navigation);
          aria-expanded marks it as a dir row. */}
      <button
        type="button"
        data-tree-path={path}
        data-tree-name={name}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onToggle(path)}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none focus-ring"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <Icon className={`size-4 shrink-0 ${color}`} />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      {group !== 'conflict' && (
        <span className="lx-hover-actions flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {group === 'unstaged' && (
            <RowAction
              title="Discard folder changes"
              danger
              onClick={() => actions.onDiscard([path], `${name}/`)}
            >
              <RotateCcw className="size-3" />
            </RowAction>
          )}
          {group === 'staged' ? (
            <RowAction title="Unstage folder" onClick={() => actions.onUnstage([path])}>
              <Minus className="size-3.5" />
            </RowAction>
          ) : (
            <RowAction title="Stage folder" onClick={() => actions.onStage([path])}>
              <Plus className="size-3.5" />
            </RowAction>
          )}
        </span>
      )}
    </WorkbenchListRow>
  )
})
