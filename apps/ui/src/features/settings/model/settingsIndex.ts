import type { SettingsTabId } from '@/shared/routing/routes'

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
  /** String tab the setting lives on (project entries are excluded — dynamic). */
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
  // General
  {
    id: 'general.name',
    tab: 'general',
    tabLabel: 'General',
    title: 'Full name',
    description: 'Your display name, shared across the workspace.',
    keywords: ['profile', 'identity', 'display name'],
    anchor: 'general-profile',
  },
  {
    id: 'general.role',
    tab: 'general',
    tabLabel: 'General',
    title: 'Primary role',
    description: 'Tailors examples and level of detail to your work.',
    keywords: ['profile', 'job', 'occupation'],
    anchor: 'general-profile',
  },
  {
    id: 'general.experience',
    tab: 'general',
    tabLabel: 'General',
    title: 'Experience level',
    description: 'How much detail and hand-holding the agent gives.',
    keywords: ['profile', 'seniority', 'beginner', 'expert'],
    anchor: 'general-profile',
  },
  {
    id: 'general.usecase',
    tab: 'general',
    tabLabel: 'General',
    title: 'Main use case',
    description: 'What you mainly use Localix for.',
    keywords: ['profile', 'workflow'],
    anchor: 'general-profile',
  },
  {
    id: 'general.response',
    tab: 'general',
    tabLabel: 'General',
    title: 'Response defaults',
    description: 'Default tone, level of detail, and format applied to all chats.',
    keywords: ['tone', 'style', 'concise', 'format', 'preferences'],
    anchor: 'general-response',
  },
  {
    id: 'general.cli',
    tab: 'general',
    tabLabel: 'General',
    title: 'Command line',
    description:
      'Install the localix command so you can open projects and files from your terminal.',
    keywords: ['cli', 'command line', 'terminal', 'localix', 'shell', 'path', 'install'],
    anchor: 'general-cli',
  },
  {
    id: 'general.updates',
    tab: 'general',
    tabLabel: 'General',
    title: 'Updates',
    description: 'Version and update check.',
    anchor: 'general-updates',
  },
  {
    id: 'general.notifications',
    tab: 'general',
    tabLabel: 'General',
    title: 'Notifications',
    description: 'Interruption condition, terminal compatibility, and the app icon unread badge.',
    keywords: ['notification', 'always', 'unfocused', 'terminal', 'osc', 'bel', 'badge', 'alert'],
    anchor: 'general-notifications',
  },
  // Preferences
  // No 'theme' entry: appearance is the rail's cycle button (dark → light → system),
  // not a settings page — there is nothing to navigate to.
  {
    id: 'prefs.typography',
    tab: 'preferences',
    tabLabel: 'Preferences',
    title: 'Typography',
    description: 'Interface and editor fonts plus text size.',
    keywords: ['font', 'font family', 'text size', 'editor font', 'monospace'],
    anchor: 'prefs-typography',
  },
  {
    id: 'prefs.setup',
    tab: 'preferences',
    tabLabel: 'Preferences',
    title: 'Replay setup',
    description: 'Reconnect a provider and choose the default model.',
    keywords: ['onboarding', 'wizard', 'provider', 'model'],
    anchor: 'prefs-setup',
  },
  {
    id: 'prefs.rail-recents',
    tab: 'preferences',
    tabLabel: 'Preferences',
    title: 'Recent views',
    description: 'How recently opened plugin views appear in the navigation rail.',
    keywords: ['rail', 'recent', 'dock', 'sidebar', 'icons', 'hover', 'collapse', 'noise'],
    anchor: 'prefs-rail-recents',
  },
  {
    id: 'prefs.spend-alert',
    tab: 'preferences',
    tabLabel: 'Preferences',
    title: 'Spend alert',
    description: 'Warn above the composer once a session’s metered spend crosses a budget.',
    keywords: ['spend', 'budget', 'cost', 'alert', 'threshold', 'money', 'usage'],
    anchor: 'prefs-spend-alert',
  },
  // Shortcuts
  {
    id: 'shortcuts.keybindings',
    tab: 'shortcuts',
    tabLabel: 'Shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Rebind keyboard shortcuts and chords.',
    keywords: ['keybinding', 'hotkey', 'chord', 'keymap'],
  },

  // Editor — code-editor behaviour: how a file saves, what the editor paints on
  // top of it, and the inline-AI assists (their model route lives in the drawer).
  {
    id: 'editor.auto-save',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Auto save',
    description: 'Automatically save editor edits after a short pause in typing. Off by default.',
    keywords: ['autosave', 'auto-save', 'save', 'editor', 'afterdelay'],
    anchor: 'editor-editing',
  },
  {
    id: 'editor.follow-agent',
    tab: 'editor',
    tabLabel: 'Editor',
    title: "Follow the agent's edits",
    description:
      'Gently reveal the code file the agent is editing so you can watch it work. Off by default.',
    keywords: ['follow', 'agent', 'edits', 'watch', 'reveal', 'auto open', 'editor', 'agentic'],
    anchor: 'editor-editing',
  },
  {
    id: 'editor.format-on-save',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Format on save',
    description: 'Run the LSP formatter on the file when you save. On by default.',
    keywords: ['format', 'lsp', 'prettier', 'on save', 'autoformat', 'formatter', 'toggle'],
    anchor: 'editor-on-save',
  },
  {
    id: 'editor.trim-whitespace',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Trim trailing whitespace',
    description: 'Strip trailing spaces and tabs from every line on save. Off by default.',
    keywords: ['whitespace', 'trailing', 'on save', 'cleanup', 'trim', 'toggle'],
    anchor: 'editor-on-save',
  },
  {
    id: 'editor.final-newline',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Insert final newline',
    description: 'Ensure the file ends with exactly one newline on save. Off by default.',
    keywords: ['newline', 'final', 'eof', 'end of file', 'on save', 'toggle'],
    anchor: 'editor-on-save',
  },
  {
    id: 'editor.git-blame',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Inline git blame',
    description:
      "Annotate the caret's line in the editor with author, date, and commit summary. On by default.",
    keywords: ['blame', 'git', 'author', 'annotate', 'gutter', 'gitlens', 'toggle'],
    anchor: 'editor-appearance',
  },
  {
    id: 'editor.scrollbar-markers',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Scrollbar markers',
    description:
      'Overview-ruler ticks on the editor scrollbar for diagnostics, git changes, and search matches. On by default.',
    keywords: [
      'scrollbar',
      'overview ruler',
      'minimap',
      'diagnostics',
      'markers',
      'git',
      'search',
      'toggle',
    ],
    anchor: 'editor-appearance',
  },
  {
    id: 'editor.bracket-colors',
    tab: 'editor',
    tabLabel: 'Editor',
    title: 'Bracket pair colorization',
    description:
      'Color matching brackets by nesting depth so nested code is easier to read. On by default.',
    keywords: [
      'rainbow brackets',
      'bracket',
      'colorize',
      'nesting',
      'pairs',
      'parentheses',
      'toggle',
    ],
    anchor: 'editor-appearance',
  },
  // Diagnostics — effective agent configuration (read-only resolved view)
  {
    id: 'diag.validation',
    tab: 'diagnostics',
    tabLabel: 'Diagnostics',
    title: 'Configuration validation',
    description: 'Cross-field checks over the resolved agent configuration.',
    keywords: ['effective config', 'diagnostics', 'validation', 'warnings', 'provenance'],
    anchor: 'diagnostics-validation',
  },
  {
    id: 'diag.models',
    tab: 'diagnostics',
    tabLabel: 'Diagnostics',
    title: 'Resolved model per consumer',
    description: 'Which model each surface and workload actually resolves to.',
    keywords: ['effective config', 'diagnostics', 'model', 'routing', 'fallback', 'resolved'],
    anchor: 'diagnostics-models',
  },
  {
    id: 'diag.tools',
    tab: 'diagnostics',
    tabLabel: 'Diagnostics',
    title: 'Effective tool policy',
    description: 'Enabled and disabled tools for the resolved capability scope.',
    keywords: ['effective config', 'diagnostics', 'tools', 'capabilities'],
    anchor: 'diagnostics-tools',
  },
  {
    id: 'diag.permissions',
    tab: 'diagnostics',
    tabLabel: 'Diagnostics',
    title: 'Permission summary',
    description: 'Resolved permission rules and where each comes from.',
    keywords: ['effective config', 'diagnostics', 'permission', 'source'],
    anchor: 'diagnostics-permissions',
  },
  {
    id: 'diag.values',
    tab: 'diagnostics',
    tabLabel: 'Diagnostics',
    title: 'Resolved values & provenance',
    description: 'Each setting, its source scope, and its hot-reload requirement.',
    keywords: ['effective config', 'diagnostics', 'provenance', 'reload', 'source', 'revision'],
    anchor: 'diagnostics-values',
  },
  {
    id: 'diag.extensions',
    tab: 'diagnostics',
    tabLabel: 'Diagnostics',
    title: 'Skills & plugins in scope',
    description: 'Skill visibility overrides and the plugins active for this scope.',
    keywords: ['effective config', 'diagnostics', 'skills', 'plugins', 'overrides'],
    anchor: 'diagnostics-extensions',
  },

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
    description: 'Drop-in plugins: tools, skills, channels. Enable is the trust gate.',
    keywords: ['plugin', 'extension', 'marketplace', 'enable'],
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
    tabLabel: 'Capabilities',
    title: 'Agents',
    description: 'Custom sub-agent roles for delegation.',
    keywords: ['agent', 'subagent', 'role', 'delegation'],
  },
]
