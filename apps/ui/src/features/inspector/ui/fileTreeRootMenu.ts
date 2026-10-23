import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { CMD } from '@/shared/lib/keybindings'
import { REVEAL_IN_OS_LABEL } from '@localixai/kit/environment'

/**
 * The explorer's BACKGROUND menu — what right-clicking the blank area below the last row offers.
 *
 * Without it that area is the single place in the tree where a
 * right-click does nothing at all (the desktop shell suppresses the browser's own menu, so there
 * is no fallback). Everything here acts on the project ROOT, because "nothing in particular is
 * selected" is what the background means in a tree.
 *
 * Described as data rather than written as JSX so it goes through the same walker as every other
 * menu in the app — the row menu beside it cannot drift from it on spacing, danger tint or how a
 * chord hint is drawn. A pure builder, so the order and the enabled/disabled rules are testable
 * without mounting the sidebar.
 */
export interface FileTreeRootMenuOps {
  /** Project root. `null` while it loads — the menu is then empty rather than acting on nothing. */
  root: string | null
  hasClipboard: boolean
  /** Whether anything is expanded, which is the only thing Collapse all could act on. */
  hasExpanded: boolean
  startCreate: (parentPath: string, kind: 'file' | 'dir') => void | Promise<unknown>
  pasteInto: (destDir: string) => void | Promise<unknown>
  refresh: () => void
  collapseAll: () => void
  reveal: (path: string) => void
  copyText: (text: string, label: string) => void
}

export function fileTreeRootMenu(ops: FileTreeRootMenuOps): MenuEntry[] {
  const { root } = ops
  if (!root) return []
  return [
    { id: 'new-file', label: 'New file…', onSelect: () => void ops.startCreate(root, 'file') },
    { id: 'new-folder', label: 'New folder…', onSelect: () => void ops.startCreate(root, 'dir') },
    { separator: true },
    {
      id: 'paste',
      label: 'Paste',
      chordId: CMD.pasteFile,
      // Present but disabled with an empty clipboard, the way every desktop file manager shows
      // it — a missing Paste reads as "this tree cannot paste".
      disabled: !ops.hasClipboard,
      onSelect: () => void ops.pasteInto(root),
    },
    { separator: true },
    { id: 'refresh', label: 'Refresh', onSelect: ops.refresh },
    {
      id: 'collapse',
      label: 'Collapse all',
      disabled: !ops.hasExpanded,
      onSelect: ops.collapseAll,
    },
    { separator: true },
    { id: 'reveal', label: REVEAL_IN_OS_LABEL, onSelect: () => ops.reveal(root) },
    { id: 'copy-path', label: 'Copy path', onSelect: () => ops.copyText(root, 'Path') },
  ]
}
