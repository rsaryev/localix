import { PREFERENCES_SETTINGS_INDEX } from './settingsPreferencesIndex'
import { SYSTEM_SETTINGS_INDEX } from './settingsSystemIndex'
import { EDITOR_SETTINGS_INDEX } from './settingsEditorIndex'
import type { SettingsTabId } from '@/shared/routing/routes'
import { KEYMAP_PRESETS } from '@/shared/lib/keybindings/presets'

/**
 * A single searchable settings entry.
 *
 * This is a lightweight INDEX layer over the hand-built settings tabs — it does
 * NOT drive rendering. Each entry describes one setting/section so a single
 * search box can filter across every tab and jump to the tab that owns it. Adding a new setting means adding an entry
 * here; rendering stays where it lives today.
 */
export interface SettingsIndexEntry {
  /** Stable id, unique across the index. */
  id: string
  /** Addressable tab that owns this setting; project settings open the project selector. */
  tab: Exclude<SettingsTabId, { kind: 'project' }>
  /** Human label for the owning tab, shown in results. */
  tabLabel: string
  /** Setting/section title. */
  title: string
  /** One-line description (also searched). */
  description: string
  /** Extra synonyms/keywords to broaden matching (not shown). */
  keywords?: string[]
  /**
   * Optional `data-settings-anchor` of the section this setting lives in. When
   * set, picking the result scrolls to + briefly flashes that section instead of
   * only switching to the owning tab. Tabs whose sections aren't tagged omit it.
   */
  anchor?: string
}

/**
 * The catalog. Grouped by tab for readability. Descriptions mirror the section
 * copy so a search hit reads the same as the panel it lands on.
 */
export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  ...PREFERENCES_SETTINGS_INDEX,

  // Shortcuts
  {
    id: 'shortcuts.keybindings',
    tab: 'shortcuts',
    tabLabel: 'Shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Rebind keyboard shortcuts and chords.',
    keywords: ['keybinding', 'hotkey', 'chord', 'keymap'],
  },

  ...EDITOR_SETTINGS_INDEX,
  {
    id: 'shortcuts.preset',
    tab: 'shortcuts',
    tabLabel: 'Shortcuts',
    title: 'Base keymap',
    description: 'Choose the base keyboard preset.',
    keywords: [
      'preset',
      'keymap',
      ...KEYMAP_PRESETS.flatMap((preset) => [preset.id, preset.label]),
    ],
  },
  {
    id: 'project.name',
    tab: 'project',
    tabLabel: 'Project',
    title: 'Display name',
    description: 'Rename the selected project.',
    keywords: ['project', 'name', 'folder'],
    anchor: 'project-name',
  },
  {
    id: 'project.instructions',
    tab: 'project',
    tabLabel: 'Project',
    title: 'Project instructions',
    description: 'Instructions applied to every agent run in the selected project.',
    keywords: ['project', 'instructions', 'system prompt', 'conventions'],
    anchor: 'project-instructions',
  },

  ...SYSTEM_SETTINGS_INDEX,

  // Capabilities
  {
    id: 'cap.tools',
    tab: 'tools',
    tabLabel: 'Capabilities',
    title: 'Tools',
    description: 'Every tool this scope knows about, and whether it may run.',
    keywords: ['tool', 'bash', 'enable', 'disable', 'catalog'],
  },
  {
    id: 'cap.skills',
    tab: 'skills',
    tabLabel: 'Capabilities',
    title: 'Skills',
    description: 'Reusable skills the agent can invoke; archive stale ones.',
    keywords: ['skill', 'archive', 'curator'],
  },
  {
    id: 'cap.mcp',
    tab: 'mcp',
    tabLabel: 'Capabilities',
    title: 'MCP servers',
    description: 'Model Context Protocol servers and their connection status.',
    keywords: ['mcp', 'server', 'stdio', 'connection', 'integration'],
  },
  {
    id: 'cap.plugins',
    tab: 'plugins',
    tabLabel: 'Capabilities',
    title: 'Plugins',
    description: 'Claude Code plugins: skills, commands, agents, hooks, MCP and LSP servers.',
    keywords: ['plugin', 'claude code', 'marketplace', 'enable'],
  },
  {
    id: 'cap.mini-apps',
    tab: 'mini-apps',
    tabLabel: 'Capabilities',
    title: 'Mini apps',
    description:
      'Apps with their own screens and tools: turn them on or off, change their settings.',
    keywords: ['mini app', 'app', 'screens', 'enable'],
  },
  {
    id: 'cap.rules',
    tab: 'rules',
    tabLabel: 'Capabilities',
    title: 'Permission rules',
    description: 'One ordered list for every kind: argument patterns, ask, and which rule wins.',
    keywords: ['permission', 'rule', 'allow', 'deny', 'ask', 'order', 'security', 'policy'],
  },
  {
    id: 'cap.agents',
    tab: 'agents',
    tabLabel: 'Agents',
    title: 'Agents',
    description: 'Custom sub-agent roles for delegation.',
    keywords: ['agent', 'subagent', 'role', 'delegation'],
  },
]
