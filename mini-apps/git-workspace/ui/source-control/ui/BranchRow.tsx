import {
  ArrowDown,
  ArrowUp,
  Check,
  Cloud,
  GitBranch,
  GitMerge,
  Lock,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { Input } from '@localixai/kit/input'
import { MatchedText } from '@localixai/kit/matched-text'
import { Spinner } from '@localixai/kit/spinner'
import { BulkAction } from './sourceControlParts'
import { WorkbenchListRow } from '@localixai/kit/workbench-list-row'
import { focusOnMount } from './focusOnMount'

export interface BranchListItem {
  name: string
  ahead: number
  behind: number
  /** Set when held by ANOTHER worktree — git forbids the same branch in two trees. */
  worktreePath?: string
}

/** One branch: switch by clicking the name, rename and delete on hover. */
export function BranchRow({
  branch,
  isCurrent,
  switching,
  pending,
  currentBranch,
  query = '',
  onPick,
  onRename,
  onDelete,
  onMerge,
}: {
  branch: BranchListItem
  isCurrent: boolean
  switching: boolean
  /** An op on THIS branch is in flight (other rows stay live). */
  pending?: boolean
  /** Name of the branch a merge would land in — the menu says so out loud. */
  currentBranch?: string | null
  /** The active filter, so the row can show which characters matched. */
  query?: string
  onPick: () => void
  onRename: () => void
  onDelete: () => void
  /** Merge this branch INTO the current one; `noFastForward` always records a merge commit. */
  onMerge?: (noFastForward: boolean) => void
}) {
  // A held branch says so with a lock rather than offering a click that can only fail.
  const held = Boolean(branch.worktreePath)
  const locked = held || pending === true
  // The same actions the row does, reachable by right-click. Disabled rather than absent
  // where git forbids the action, so the row explains itself instead of appearing to lack it.
  const menu: MenuEntry[] = [
    {
      id: 'switch',
      label: 'Switch to this branch',
      icon: GitBranch,
      disabled: isCurrent || locked || switching,
      onSelect: onPick,
    },
    ...(onMerge
      ? ([
          { separator: true },
          {
            id: 'merge',
            label: currentBranch ? `Merge into ${currentBranch}` : 'Merge into current branch',
            icon: GitMerge,
            disabled: isCurrent || pending === true || !currentBranch,
            onSelect: () => onMerge(false),
          },
          {
            id: 'merge-no-ff',
            label: 'Merge with a merge commit',
            icon: GitMerge,
            disabled: isCurrent || pending === true || !currentBranch,
            onSelect: () => onMerge(true),
          },
        ] satisfies MenuEntry[])
      : []),
    { separator: true },
    { id: 'rename', label: 'Rename…', icon: Pencil, disabled: locked, onSelect: onRename },
    {
      id: 'delete',
      label: 'Delete branch…',
      icon: Trash2,
      danger: true,
      disabled: isCurrent || locked,
      onSelect: onDelete,
    },
  ]
  const row = (
    <WorkbenchListRow
      density="dense"
      active={isCurrent}
      className="group/branch min-w-0 gap-1.5 rounded-none px-2"
    >
      {pending ? (
        <Spinner className="size-4 shrink-0 text-text-faint" />
      ) : (
        <GitBranch className="size-4 shrink-0 text-text-faint" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-ring disabled:cursor-default"
        disabled={isCurrent || locked || switching}
        title={held ? `Open in ${branch.worktreePath}` : `Switch to ${branch.name}`}
        onClick={onPick}
      >
        <MatchedText
          text={branch.name}
          query={query}
          plainClassName="min-w-0 truncate font-medium"
          dimClassName="min-w-0 truncate font-medium text-text-soft"
        />
        {isCurrent && <Check className="size-3 shrink-0 text-status-success" />}
        {held && <Lock className="size-3 shrink-0 text-text-faint" />}
        <AheadBehind ahead={branch.ahead} behind={branch.behind} />
      </button>
      {/* `lx-hover-actions` like every other row: without it touch devices, which never hover,
          could not reach rename/delete at all. */}
      <span className="lx-hover-actions flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/branch:opacity-100 group-hover/branch:opacity-100">
        {onMerge && !isCurrent && currentBranch && (
          <BulkAction
            title={`Merge into ${currentBranch}`}
            onClick={() => onMerge(false)}
            disabled={pending}
          >
            <GitMerge className="size-3.5" />
          </BulkAction>
        )}
        <BulkAction title="Rename" onClick={onRename} disabled={locked}>
          <Pencil className="size-3.5" />
        </BulkAction>
        <BulkAction danger title="Delete" onClick={onDelete} disabled={isCurrent || locked}>
          <Trash2 className="size-3.5" />
        </BulkAction>
      </span>
    </WorkbenchListRow>
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * A branch that exists only on a remote. There is exactly one thing to do with
 * it — start working on it — so the whole row is that one action: it creates the
 * local tracking branch and switches to it.
 */
export function RemoteBranchRow({
  name,
  shortName,
  updatedAt,
  pending,
  query = '',
  onCheckout,
}: {
  name: string
  shortName: string
  updatedAt?: string
  pending?: boolean
  query?: string
  onCheckout: () => void
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onCheckout}
      title={`Check out ${name} as a local branch`}
      className="flex min-h-[var(--chrome-control-md)] w-full items-center gap-1.5 pl-2 pr-2 text-left text-xs text-text-soft outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
    >
      {pending ? (
        <Spinner className="size-4 shrink-0 text-text-faint" />
      ) : (
        <Cloud className="size-4 shrink-0 text-text-faint" />
      )}
      <MatchedText
        text={shortName}
        query={query}
        plainClassName="min-w-0 truncate font-medium"
        dimClassName="min-w-0 truncate font-medium text-text-soft"
      />
      <span className="shrink-0 text-2xs text-text-faint">{name.slice(0, name.indexOf('/'))}</span>
      {updatedAt && <span className="ml-auto shrink-0 text-2xs text-text-faint">{updatedAt}</span>}
    </button>
  )
}

/**
 * The one input this whole section exists for — shared by create and rename, never both at once.
 *
 * A status menu is DATA (`MenuEntry` is a label and an `onSelect`), so it can offer the
 * switch but has nowhere to put a name. That is the entire reason branch management lives in the
 * panel and not in the titlebar item beside it.
 */
export function BranchDraft({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  busy,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void | Promise<void>
  onCancel: () => void
  placeholder: string
  busy: boolean
}) {
  return (
    <div className="px-2 py-1">
      <Input
        ref={focusOnMount}
        value={value}
        placeholder={placeholder}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        // Blur cancels rather than commits: the row's own delete button blurs this field on the
        // way to being clicked, and a branch created by accident is worse than one not created.
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void onSubmit()
          if (event.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}

/** Compact `↑2 ↓1`; nothing when the branch is in sync or has no upstream. */
function AheadBehind({ ahead, behind }: { ahead: number; behind: number }) {
  if (ahead === 0 && behind === 0) return null
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-2xs text-text-faint"
      aria-label={`${ahead} ahead, ${behind} behind`}
    >
      {ahead > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowUp className="size-3" aria-hidden="true" />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowDown className="size-3" aria-hidden="true" />
          {behind}
        </span>
      )}
    </span>
  )
}
