import type { BindingOverrides } from '@localixai/kit/keybindings'
import type { OsFamily } from '@localixai/kit/environment'
import { CMD } from './catalog'

export interface KeymapPreset {
  id: string
  label: string
  description: string
  overrides: BindingOverrides
  platformOverrides?: Partial<Record<OsFamily, BindingOverrides>>
}

export const KEYMAP_PLATFORMS = ['mac', 'windows', 'linux'] as const

const desktopTabs = {
  [CMD.nextEditor]: 'mod+pagedown',
  [CMD.prevEditor]: 'mod+pageup',
}
const macTabs = {
  [CMD.nextEditor]: 'mod+alt+arrowright',
  [CMD.prevEditor]: 'mod+alt+arrowleft',
}
const macHistory = {
  [CMD.navigateBack]: 'secondary+-',
  [CMD.navigateForward]: 'secondary+shift+_',
}
const vscodeMac = { ...macTabs, ...macHistory, [CMD.toggleTerminal]: 'secondary+`' }

/** Verified sources and scope limits are recorded in docs/features/keyboard-shortcuts.md. */
export const KEYMAP_PRESETS: KeymapPreset[] = [
  { id: 'default', label: 'Default', description: 'Localix’s built-in bindings.', overrides: {} },
  {
    id: 'vscode',
    label: 'VS Code / VSCodium',
    description: 'VS Code workspace navigation, tabs, and terminal shortcuts.',
    overrides: desktopTabs,
    platformOverrides: { mac: vscodeMac },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'VS Code navigation plus Cursor’s new chat and cancellation shortcuts.',
    overrides: {
      ...desktopTabs,
      [CMD.newChat]: 'mod+n',
      [CMD.stopGeneration]: 'mod+shift+backspace',
    },
    platformOverrides: { mac: vscodeMac },
  },
  {
    id: 'windsurf',
    label: 'Windsurf / Devin Desktop',
    description: 'Compatible VS Code workspace shortcuts.',
    overrides: desktopTabs,
    platformOverrides: { mac: vscodeMac },
  },
  {
    id: 'zed',
    label: 'Zed',
    description: 'Zed’s navigation, terminal, and editor zoom shortcuts.',
    overrides: { ...desktopTabs, [CMD.toggleEditorMaximize]: 'shift+escape' },
    platformOverrides: {
      mac: vscodeMac,
      linux: { [CMD.navigateBack]: 'mod+alt+-', [CMD.navigateForward]: 'mod+alt+shift+_' },
    },
  },
  {
    id: 'jetbrains',
    label: 'JetBrains (IntelliJ)',
    description: 'IntelliJ IDEA, PyCharm, WebStorm, and Android Studio conventions.',
    overrides: {
      [CMD.commandPalette]: 'mod+shift+a',
      [CMD.goToFile]: 'mod+shift+n',
      [CMD.goToSymbol]: 'mod+f12',
      [CMD.goToSymbolWorkspace]: 'mod+alt+shift+n',
      [CMD.switchSession]: 'mod+e',
      [CMD.toggleSidebar]: 'alt+1',
      [CMD.toggleTerminal]: 'alt+f12',
      [CMD.nextEditor]: 'alt+arrowright',
      [CMD.prevEditor]: 'alt+arrowleft',
      [CMD.navigateBack]: 'mod+alt+arrowleft',
      [CMD.navigateForward]: 'mod+alt+arrowright',
    },
    platformOverrides: {
      mac: {
        [CMD.goToFile]: 'mod+shift+o',
        [CMD.goToSymbolWorkspace]: 'mod+alt+o',
        [CMD.toggleSidebar]: 'mod+1',
        [CMD.nextEditor]: 'mod+shift+}',
        [CMD.prevEditor]: 'mod+shift+{',
        [CMD.navigateBack]: 'mod+[',
        [CMD.navigateForward]: 'mod+]',
      },
    },
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    description: 'Go to file, document/project symbols, and tab navigation.',
    overrides: {
      ...desktopTabs,
      [CMD.goToSymbol]: 'mod+r',
      [CMD.goToSymbolWorkspace]: 'mod+shift+r',
    },
    platformOverrides: {
      mac: {
        [CMD.goToFile]: 'mod+t',
        [CMD.nextEditor]: 'secondary+pagedown',
        [CMD.prevEditor]: 'secondary+pageup',
      },
    },
  },
  {
    id: 'atom',
    label: 'Atom',
    description: 'File and symbol finders, sidebar, and recent sessions.',
    overrides: {
      [CMD.goToFile]: 'mod+t',
      [CMD.goToSymbol]: 'mod+r',
      [CMD.goToSymbolWorkspace]: 'mod+shift+r',
      [CMD.switchSession]: 'mod+b',
      [CMD.toggleSidebar]: 'mod+\\',
      // Atom splits use multi-stroke chords; reserve this single chord for its sidebar.
      [CMD.splitEditor]: null,
    },
  },
  {
    id: 'textmate',
    label: 'TextMate',
    description: 'TextMate-style file and document symbol navigation.',
    overrides: {
      [CMD.goToFile]: 'mod+t',
      [CMD.goToSymbol]: 'mod+shift+t',
      // TextMate reuses this chord in different contexts; our two finders share one context.
      [CMD.goToSymbolWorkspace]: null,
    },
    platformOverrides: { mac: { [CMD.toggleSidebar]: 'mod+secondary+alt+d' } },
  },
  {
    id: 'visual-studio',
    label: 'Visual Studio',
    description: 'Visual Studio-style command search, outline, history, and tabs.',
    overrides: {
      [CMD.commandPalette]: 'mod+q',
      [CMD.goToSymbol]: 'mod+alt+t',
      [CMD.pickTheme]: null,
      [CMD.toggleSidebar]: 'mod+alt+l',
      [CMD.navigateBack]: 'mod+-',
      [CMD.navigateForward]: 'mod+shift+_',
      [CMD.nextEditor]: 'mod+f6',
      [CMD.prevEditor]: 'mod+shift+f6',
    },
    // Cmd+Q quits macOS apps; preserve the local command palette there.
    platformOverrides: { mac: { [CMD.commandPalette]: 'mod+shift+p' } },
  },
  {
    id: 'eclipse',
    label: 'Eclipse',
    description: 'Quick Access, Open Resource, Search, and editor tab navigation.',
    overrides: {
      [CMD.commandPalette]: 'mod+3',
      [CMD.goToFile]: 'mod+shift+r',
      [CMD.globalSearch]: 'mod+h',
      [CMD.nextEditor]: 'mod+f6',
      [CMD.prevEditor]: 'mod+shift+f6',
    },
    platformOverrides: { mac: { [CMD.navigateBack]: 'mod+[', [CMD.navigateForward]: 'mod+]' } },
  },
  {
    id: 'xcode',
    label: 'Xcode',
    description: 'Open Quickly and document symbol navigation.',
    overrides: { [CMD.goToFile]: 'mod+shift+o', [CMD.goToSymbol]: 'mod+6' },
    platformOverrides: { mac: { [CMD.goToSymbol]: 'secondary+6' } },
  },
  {
    id: 'notepad-plus-plus',
    label: 'Notepad++',
    description: 'Next/previous document and find-in-files conventions.',
    overrides: desktopTabs,
  },
  {
    id: 'emacs',
    label: 'Emacs (workspace)',
    description: 'M-x command palette and M-, back navigation; single-stroke shortcuts only.',
    overrides: { [CMD.commandPalette]: 'alt+x', [CMD.navigateBack]: 'alt+,' },
  },
  ...(['vim', 'neovim', 'helix'] as const).map((id) => ({
    id,
    label: `${id === 'neovim' ? 'Neovim' : id === 'helix' ? 'Helix' : 'Vim'} (navigation)`,
    description: 'Ctrl+O / Ctrl+I jump history in the workspace; modal editing is not enabled.',
    overrides: { [CMD.navigateBack]: 'mod+o', [CMD.navigateForward]: 'mod+i' },
    platformOverrides: {
      mac: { [CMD.navigateBack]: 'secondary+o', [CMD.navigateForward]: 'secondary+i' },
    },
  })),
]
