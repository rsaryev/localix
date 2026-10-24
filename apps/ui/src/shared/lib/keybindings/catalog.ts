/**
 * The single source of truth for every user-facing keyboard shortcut. Each
 * entry carries a stable `id` (the persistence key), a human label/description
 * for the settings page, a category for grouping, and a platform-neutral
 * default chord. Commands flagged `configurable: false` are intrinsic
 * interaction keys (typing/menu navigation) shown for reference only — they are
 * not routed through the override registry.
 *
 * Adding a shortcut = one entry here + consulting `useKeybindingMatcher()`
 * (or `resolved[id]`) at the handler site.
 */

import type { ShortcutCategory, ShortcutCommand } from '@localixai/kit/keybindings'

import { CMD } from './command-ids'
import { NAVIGATION_SHORTCUTS } from './navigation-shortcuts'

export { CMD } from './command-ids'

/** Display metadata for each category (ordered as shown in settings). */
export const CATEGORY_META: Record<ShortcutCategory, { label: string }> = {
  navigation: { label: 'Navigation' },
  layout: { label: 'Layout & panels' },
  editor: { label: 'Editor tabs' },
  search: { label: 'Search' },
  composer: { label: 'Composer' },
  files: { label: 'File tree' },
}

export const CATEGORY_ORDER: ShortcutCategory[] = [
  'navigation',
  'layout',
  'editor',
  'search',
  'composer',
  'files',
]

export const SHORTCUT_CATALOG: ShortcutCommand[] = [
  ...NAVIGATION_SHORTCUTS,
  {
    id: CMD.toggleAgentIsland,
    label: 'Toggle agent island',
    description: 'Desktop global shortcut. Expand or collapse the agent island from any app.',
    category: 'navigation',
    defaultChord: 'mod+shift+j',
    configurable: false,
  },

  // Layout & panels
  {
    id: CMD.toggleSidebar,
    label: 'Toggle sidebar',
    description: 'Show or hide the left sidebar.',
    category: 'layout',
    defaultChord: 'mod+b',
  },
  {
    id: CMD.toggleEditorMaximize,
    label: 'Maximize editor group',
    description: 'Maximize or restore the focused editor group.',
    category: 'layout',
    defaultChord: 'mod+j',
  },
  {
    id: CMD.toggleTerminal,
    label: 'Toggle terminal',
    description: 'Open a terminal tab in the editor grid.',
    category: 'layout',
    defaultChord: 'mod+`',
  },
  {
    id: CMD.focusNextGroup,
    label: 'Focus next editor group',
    description: 'Move focus to the next editor group in the grid.',
    category: 'layout',
    defaultChord: 'mod+alt+arrowdown',
  },
  {
    id: CMD.focusPrevGroup,
    label: 'Focus previous editor group',
    description: 'Move focus to the previous editor group in the grid.',
    category: 'layout',
    defaultChord: 'mod+alt+arrowup',
  },
  {
    id: CMD.focusNextPart,
    label: 'Focus next part',
    description: 'Move focus to the next workspace part (sidebar → editor → chat).',
    category: 'layout',
    defaultChord: 'f6',
  },
  {
    id: CMD.focusPrevPart,
    label: 'Focus previous part',
    description: 'Move focus to the previous workspace part (chat → editor → sidebar).',
    category: 'layout',
    defaultChord: 'shift+f6',
  },

  // Editor tabs
  {
    id: CMD.closeEditor,
    label: 'Close editor tab',
    description: 'Close the active tab in the focused editor group.',
    category: 'editor',
    defaultChord: 'mod+w',
    when: 'editorFocus && !inputFocus && !menuOpen',
  },
  {
    id: CMD.nextEditor,
    label: 'Next editor tab',
    description: 'Cycle to the next tab in the focused group.',
    category: 'editor',
    defaultChord: 'mod+alt+arrowright',
  },
  {
    id: CMD.prevEditor,
    label: 'Previous editor tab',
    description: 'Cycle to the previous tab in the focused group.',
    category: 'editor',
    defaultChord: 'mod+alt+arrowleft',
  },
  {
    id: CMD.reopenClosedTab,
    label: 'Reopen closed tab',
    description: 'Reopen the most recently closed file tab.',
    category: 'editor',
    defaultChord: 'mod+shift+t',
  },

  // Search
  {
    id: CMD.findInChat,
    label: 'Find in conversation',
    description: 'Open in-conversation find for the current chat.',
    category: 'search',
    defaultChord: 'mod+f',
  },

  // Composer
  {
    id: CMD.stopGeneration,
    label: 'Stop generation',
    description: 'Stop the running response (after closing any open menu).',
    category: 'composer',
    defaultChord: 'escape',
  },
  {
    id: CMD.submitMessageEdit,
    label: 'Submit message edit',
    description: 'Save an in-place edit to a sent message.',
    category: 'composer',
    defaultChord: 'mod+enter',
  },
  {
    id: CMD.sendMessage,
    label: 'Send message',
    description: 'Send the composer message. Built-in — not rebindable.',
    category: 'composer',
    defaultChord: 'enter',
    configurable: false,
  },
  {
    id: CMD.insertNewline,
    label: 'Insert newline',
    description: 'Add a line break in the composer. Built-in — not rebindable.',
    category: 'composer',
    defaultChord: 'shift+enter',
    configurable: false,
  },
  {
    id: CMD.acceptSuggestion,
    label: 'Accept suggestion',
    description: 'Accept the inline next-step / ghost-text suggestion. Built-in.',
    category: 'composer',
    defaultChord: 'tab',
    configurable: false,
  },
  {
    id: CMD.promptHistoryPrev,
    label: 'Previous prompt',
    description: 'Recall the previous prompt from history. Built-in.',
    category: 'composer',
    defaultChord: 'arrowup',
    configurable: false,
  },
  {
    id: CMD.promptHistoryNext,
    label: 'Next prompt',
    description: 'Recall the next prompt from history. Built-in.',
    category: 'composer',
    defaultChord: 'arrowdown',
    configurable: false,
  },
  {
    id: CMD.modBandPrevPage,
    label: 'Previous mod band page',
    description: 'Show the previous page of the mods band above the composer.',
    category: 'composer',
    defaultChord: 'alt+[',
  },
  {
    id: CMD.modBandNextPage,
    label: 'Next mod band page',
    description: 'Show the next page of the mods band above the composer.',
    category: 'composer',
    defaultChord: 'alt+]',
  },

  // File tree
  {
    id: CMD.renameFile,
    label: 'Rename',
    description: 'Rename the selected file or folder.',
    category: 'files',
    defaultChord: 'f2',
  },
  {
    id: CMD.deleteFile,
    label: 'Delete',
    description: 'Delete the selected file or folder (Backspace also works).',
    category: 'files',
    defaultChord: 'delete',
  },
  {
    id: CMD.cutFile,
    label: 'Cut',
    description: 'Cut the selected file or folder, ready to paste (move) into another folder.',
    category: 'files',
    defaultChord: 'mod+x',
  },
  {
    id: CMD.copyFile,
    label: 'Copy',
    description:
      'Copy the selected file or folder, ready to paste (duplicate) into another folder.',
    category: 'files',
    defaultChord: 'mod+c',
  },
  {
    id: CMD.pasteFile,
    label: 'Paste',
    description:
      'Paste the cut/copied entry into the selected folder (or the focused file’s folder).',
    category: 'files',
    defaultChord: 'mod+v',
  },
]

export function isConfigurable(command: ShortcutCommand): boolean {
  return command.configurable !== false
}
