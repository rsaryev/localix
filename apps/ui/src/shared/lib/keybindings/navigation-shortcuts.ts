import { isDesktop, IS_MAC } from '@localixai/kit/environment'
import type { ShortcutCommand } from '@localixai/kit/keybindings'

import { CMD } from './command-ids'

export const NAVIGATION_SHORTCUTS: ShortcutCommand[] = [
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
    description: 'Cycle the appearance: dark, light, then system.',
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
]
