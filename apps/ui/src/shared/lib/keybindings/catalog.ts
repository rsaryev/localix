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

import { isDesktop, IS_MAC } from '@localixai/kit/environment'
import type { ShortcutCategory, ShortcutCommand } from '@localixai/kit/keybindings'

/** Stable command ids — referenced by the handler sites that route through the registry. */
export const CMD = {
  commandPalette: 'nav.command-palette',
  globalSearch: 'nav.global-search',
  newChat: 'nav.new-chat',
  newWorkspaceTab: 'native.new-workspace-tab',
  newWorkspaceWindow: 'native.new-workspace-window',
  goToFile: 'nav.go-to-file',
  switchSession: 'nav.switch-session',
  switchProject: 'nav.switch-project',
  goToSymbol: 'nav.go-to-symbol',
  goToSymbolWorkspace: 'nav.go-to-symbol-workspace',
  pickTheme: 'nav.pick-theme',
  navigateBack: 'nav.navigate-back',
  navigateForward: 'nav.navigate-forward',
  prevPrompt: 'nav.prev-prompt',
  nextPrompt: 'nav.next-prompt',
  toggleSidebar: 'layout.toggle-sidebar',
  toggleEditorMaximize: 'layout.toggle-editor-maximize',
  toggleTerminal: 'layout.toggle-terminal',
  focusNextGroup: 'layout.focus-next-group',
  focusPrevGroup: 'layout.focus-prev-group',
  focusNextPart: 'layout.focus-next-part',
  focusPrevPart: 'layout.focus-prev-part',
  closeEditor: 'editor.close-tab',
  nextEditor: 'editor.next-tab',
  prevEditor: 'editor.prev-tab',
  reopenClosedTab: 'editor.reopen-closed-tab',
  findInChat: 'search.find-in-chat',
  stopGeneration: 'composer.stop-generation',
  submitMessageEdit: 'composer.submit-message-edit',
  sendMessage: 'composer.send-message',
  insertNewline: 'composer.insert-newline',
  acceptSuggestion: 'composer.accept-suggestion',
  promptHistoryPrev: 'composer.prompt-history-prev',
  promptHistoryNext: 'composer.prompt-history-next',
  renameFile: 'files.rename',
  deleteFile: 'files.delete',
  cutFile: 'files.cut',
  copyFile: 'files.copy',
  pasteFile: 'files.paste',
} as const

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
  ...(isDesktop && IS_MAC
    ? [
        {
          id: CMD.newWorkspaceTab,
          label: 'New workspace tab',
          description: 'Open a native macOS workspace tab.',
          category: 'navigation' as const,
          defaultChord: 'mod+t',
          configurable: false,
        },
        {
          id: CMD.newWorkspaceWindow,
          label: 'New workspace window',
          description: 'Open a separate macOS workspace window.',
          category: 'navigation' as const,
          defaultChord: 'mod+alt+shift+n',
          configurable: false,
        },
      ]
    : []),
  // Navigation
  {
    id: CMD.commandPalette,
    label: 'Command palette',
    description: 'Search and run any workspace command by name.',
    category: 'navigation',
    defaultChord: 'mod+shift+p',
  },
  {
    id: CMD.globalSearch,
    label: 'Global search',
    description:
      'Search across the whole workspace — projects, chats, messages, databases, settings and more.',
    category: 'navigation',
    defaultChord: 'mod+shift+f',
  },
  {
    id: CMD.newChat,
    label: 'New chat',
    description: 'Start a new global chat session.',
    category: 'navigation',
    defaultChord: 'mod+alt+n',
  },
  {
    id: CMD.goToFile,
    label: 'Go to file',
    description: 'Open the go-to-file palette to jump to any file.',
    category: 'navigation',
    defaultChord: 'mod+p',
  },
  {
    id: CMD.switchSession,
    label: 'Switch session',
    description: 'Open the session switcher palette.',
    category: 'navigation',
    defaultChord: 'mod+k',
  },
  {
    id: CMD.switchProject,
    label: 'Switch project',
    description: 'Open the project quick-switcher (recently opened folders, most-recent first).',
    category: 'navigation',
    defaultChord: 'mod+alt+p',
  },
  {
    id: CMD.goToSymbol,
    label: 'Go to symbol in file',
    description: 'Jump to a symbol in the current file (document outline).',
    category: 'navigation',
    defaultChord: 'mod+shift+o',
  },
  {
    id: CMD.goToSymbolWorkspace,
    label: 'Go to symbol in workspace',
    description: 'Search for a symbol across the whole workspace.',
    category: 'navigation',
    defaultChord: 'mod+t',
  },
  {
    id: CMD.pickTheme,
    label: 'Color theme',
    description:
      'Open the color-theme quick pick to preview and switch color mode and plugin presets.',
    category: 'navigation',
    defaultChord: 'mod+alt+t',
  },
  {
    id: CMD.navigateBack,
    label: 'Go back',
    description: 'Return to the previous location in your navigation history.',
    category: 'navigation',
    defaultChord: 'alt+arrowleft',
    when: '!inputFocus && !menuOpen',
  },
  {
    id: CMD.navigateForward,
    label: 'Go forward',
    description: 'Move forward again through your navigation history.',
    category: 'navigation',
    defaultChord: 'alt+arrowright',
    when: '!inputFocus && !menuOpen',
  },
  {
    id: CMD.prevPrompt,
    label: 'Previous prompt',
    description: 'Scroll the transcript to the previous user prompt.',
    category: 'navigation',
    defaultChord: 'alt+arrowup',
    when: '!inputFocus && !menuOpen',
  },
  {
    id: CMD.nextPrompt,
    label: 'Next prompt',
    description: 'Scroll the transcript to the next user prompt.',
    category: 'navigation',
    defaultChord: 'alt+arrowdown',
    when: '!inputFocus && !menuOpen',
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
