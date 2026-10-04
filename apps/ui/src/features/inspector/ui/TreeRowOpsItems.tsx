import { ContextMenuItem, ContextMenuSeparator } from '@localixai/kit/context-menu'
import { ChordHint } from '@localixai/kit/chord-hint'
import { CMD } from '@/shared/lib/keybindings'
import { relativePath } from '@localixai/plugin-sdk/ui/utilities'
import { REVEAL_IN_OS_LABEL } from '@localixai/kit/environment'
import type { TreeRowOps, TreeRowTarget } from './treeRowOps'

/** Label for the delete item — a multi-selection deletes the whole set. */
function deleteLabel(ops: TreeRowOps, path: string): string {
  return ops.selected.has(path) && ops.selected.size > 1
    ? `Delete ${ops.selected.size} items`
    : 'Delete'
}

/**
 * The context-menu items every tree row shares, in their canonical order. A caller
 * renders its own row-specific items around this block (folder: New file/folder above;
 * file: Open + the Compare group above, Copy name folded in below).
 */
export function TreeRowOpsItems({
  ops,
  target,
  isDir,
}: {
  ops: TreeRowOps
  target: TreeRowTarget
  isDir: boolean
}) {
  const { row, entry, parentPath, pasteTarget } = target
  const { path } = row
  return (
    <>
      <ContextMenuItem onSelect={() => ops.startRename(entry, parentPath)}>
        Rename…
        <ChordHint commandId={CMD.renameFile} />
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void ops.duplicate(row)}>Duplicate</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => ops.clip(row, 'cut')}>
        Cut
        <ChordHint commandId={CMD.cutFile} />
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => ops.clip(row, 'copy')}>
        Copy
        <ChordHint commandId={CMD.copyFile} />
      </ContextMenuItem>
      <ContextMenuItem disabled={!ops.clipboard} onSelect={() => void ops.pasteInto(pasteTarget)}>
        Paste
        <ChordHint commandId={CMD.pasteFile} />
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => ops.reveal(path)}>{REVEAL_IN_OS_LABEL}</ContextMenuItem>
      <ContextMenuItem onSelect={() => ops.copyText(path, 'Path')}>Copy path</ContextMenuItem>
      <ContextMenuItem
        onSelect={() => ops.copyText(relativePath(ops.root ?? '', path), 'Relative path')}
      >
        Copy relative path
      </ContextMenuItem>
      {!isDir && (
        <ContextMenuItem onSelect={() => ops.copyText(entry.name, 'Name')}>
          Copy name
        </ContextMenuItem>
      )}
      {ops.addToIgnore && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => ops.addToIgnore?.(path, isDir)}>
            {ops.ignoreLabel ?? 'Add to ignore list'}
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem tone="danger" onSelect={() => ops.requestDelete(row)}>
        {deleteLabel(ops, path)}
        <ChordHint commandId={CMD.deleteFile} />
      </ContextMenuItem>
      <ContextMenuItem tone="danger" onSelect={() => ops.requestDelete(row, true)}>
        Delete permanently…
      </ContextMenuItem>
    </>
  )
}
