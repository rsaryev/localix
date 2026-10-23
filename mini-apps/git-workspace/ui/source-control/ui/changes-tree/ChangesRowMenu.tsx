import { ContextMenuItem, ContextMenuSeparator } from '@localixai/kit/context-menu'
import type { ChangeActions } from '../../model/changeActions'
import type { ChangeGroup } from './ChangesTreeRow'
import type { ChangesTreeRow } from './changesTreeRows'

/** Repo-root-anchored .gitignore line for a change-tree entry (folders get a trailing slash). */
function gitignorePattern(path: string, isDir: boolean): string {
  return `/${path}${isDir ? '/' : ''}`
}

/** Whether right-clicking this row opens a menu at all (a Merge folder offers nothing). */
export function rowHasMenu(row: ChangesTreeRow, group: ChangeGroup): boolean {
  return row.kind === 'file' || group !== 'conflict'
}

/**
 * The context-menu entries for ONE row, rendered inside the tree's single delegated menu.
 * Parity with the hover buttons, so the full set is reachable without hovering the exact icon.
 */
export function ChangesRowMenu({
  row,
  group,
  actions,
}: {
  row: ChangesTreeRow
  group: ChangeGroup
  actions: ChangeActions
}) {
  const conflicted = group === 'conflict'
  const staged = group === 'staged'
  if (row.kind === 'dir') {
    return (
      <>
        {staged ? (
          <ContextMenuItem onSelect={() => actions.onUnstage([row.path])}>
            Unstage folder
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => actions.onStage([row.path])}>
            Stage folder
          </ContextMenuItem>
        )}
        {!staged && (
          <ContextMenuItem
            onSelect={() => actions.onDiscard([row.path], `${row.name}/`)}
            tone="danger"
          >
            Discard folder changes
          </ContextMenuItem>
        )}
        {actions.onAddToGitignore && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => actions.onAddToGitignore?.([gitignorePattern(row.path, true)])}
            >
              Add to .gitignore
            </ContextMenuItem>
          </>
        )}
      </>
    )
  }
  const { file } = row
  return (
    <>
      {file.status !== 'deleted' && actions.onOpenFile && (
        <ContextMenuItem onSelect={() => actions.onOpenFile?.(file)}>Open file</ContextMenuItem>
      )}
      {conflicted ? (
        <ContextMenuItem onSelect={() => actions.onStage([file.path])}>
          Stage as resolved
        </ContextMenuItem>
      ) : staged ? (
        <ContextMenuItem onSelect={() => actions.onUnstage([file.path])}>Unstage</ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => actions.onStage([file.path])}>Stage</ContextMenuItem>
      )}
      {group === 'unstaged' && (
        <ContextMenuItem onSelect={() => actions.onDiscard([file.path], row.name)} tone="danger">
          Discard changes
        </ContextMenuItem>
      )}
      {!conflicted && actions.onAddToGitignore && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => actions.onAddToGitignore?.([gitignorePattern(file.path, false)])}
          >
            Add to .gitignore
          </ContextMenuItem>
        </>
      )}
    </>
  )
}
