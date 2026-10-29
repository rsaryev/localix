// A shot is evidence for a user action, never decoration for every document.
export const capturePlan = {
  'agents/edit-command-tokens': {
    guide: 'features/agent-management.md',
    purpose: 'Agent command flags and values have separate editable crumbs',
    scenario: 'agent-command',
  },
  'local-models/settings': {
    guide: 'features/local-models.md',
    purpose: 'The installed models and the labs’ models to download, each sized for this computer',
    scenario: 'local-models-settings',
    requires: 'LOCALIX_CAPTURE_LOCAL_MODELS',
    start: 'home',
  },
  'search/meaning-match': {
    guide: 'features/semantic-search.md',
    purpose: 'A query sharing no word with the fixture finds its layouts message by meaning',
    scenario: 'semantic-search',
    requires: 'LOCALIX_CAPTURE_LOCAL_MODELS',
    start: 'project',
  },
  'browser/agent-preview': {
    guide: 'features/visual-feedback.md',
    purpose: 'Live local preview after a real release-review action beside the seeded conversation',
    scenario: 'browser-preview',
  },
  'browser/visual-feedback-comment': {
    guide: 'features/visual-feedback.md',
    purpose: 'A preview comment reopened from its element, numbered, to edit or delete',
    scenario: 'visual-feedback',
  },
  'context/composer-context': {
    guide: 'features/workspace.md',
    purpose: 'Automatic open-file and terminal context with source labels and estimated sizes',
    scenario: 'composer-context',
  },
  'workspace/session-window-drag': {
    guide: 'features/workspace.md',
    purpose:
      'A sidebar conversation links into the composer without opening workspace destinations',
    scenario: 'session-window-drag',
    preservePointer: true,
  },
  'workspace/terminal-error': {
    guide: 'features/workspace.md',
    purpose: 'A failed terminal retains its output without a footer and restarts from its tab menu',
    scenario: 'terminal-error',
  },
  'external-agents/history': {
    guide: 'features/external-agents.md',
    purpose: 'Real Claude Code terminal beside the Localix conversation',
    scenario: 'external-terminal',
    scope: 'external',
    requires: 'LOCALIX_CAPTURE_CLAUDE',
  },
  'agents/context-and-limits': {
    guide: 'features/agents.md',
    purpose: 'An agent’s page in the Store: standing instructions and turn budget',
    scenario: 'agent',
  },
  'agents/create-from-chat': {
    guide: 'features/agent-management.md',
    purpose:
      'A user’s /agents create command opens the Store’s Add agent form with the specialist’s name and description filled in',
    scenario: 'agent-management',
  },
  'providers/model-browser': {
    guide: 'features/providers.md',
    purpose: 'Model discovery and provider connection, with no account secrets',
    scenario: 'models',
  },
  'providers/cloud-connection-settings': {
    guide: 'features/providers.md',
    purpose: 'A cloud provider asks for its region beside the key and waits for the key to add it',
    scenario: 'cloud-connection',
    start: 'project',
  },
  'chat/unfinished-reply': {
    guide: 'features/sessions-and-projects.md',
    purpose:
      'A reply a restart cut off: a quiet marker in the transcript, Continue above the composer',
    scenario: 'unfinished-reply',
    start: 'project',
  },
  'chat/tool-call-sections': {
    guide: 'features/sessions-and-projects.md',
    purpose:
      'Three finished tool calls opened: each shows what it was given under In and what came back under Out',
    scenario: 'tool-sections',
    start: 'project',
  },
  'chat/agent-card-live': {
    guide: 'features/delegation.md',
    purpose:
      'Two subagent calls: one started in the background and still running, one finished, each card naming its child status and opening its session',
    scenario: 'agent-children',
    start: 'project',
  },
  'settings/section-picker': {
    guide: 'features/settings.md',
    purpose: 'Settings search with the section tabs under it, the active tab in view',
    scenario: 'settings-strip',
    start: 'project',
  },
  'store/discover': {
    guide: 'features/mini-apps.md',
    purpose: 'Discover: Start here, rows by kind and the categories, from one answer',
    scenario: 'store-discover',
    start: 'home',
  },
  'store/mini-apps': {
    guide: 'features/mini-apps.md',
    purpose: 'The Mini apps shelf: tiles with a Get button, Open on the three installed',
    scenario: 'store',
    start: 'home',
  },
  'store/plugins': {
    guide: 'features/mini-apps.md',
    purpose: 'The Plugins shelf: a long list read a page at a time, a monogram for a missing icon',
    scenario: 'store-plugins',
    start: 'home',
  },
  'store/listing': {
    guide: 'features/mini-apps.md',
    purpose: 'One mini app’s page in the Store: screenshots and what is inside it',
    scenario: 'store-listing',
    start: 'home',
  },
  'store/consent': {
    guide: 'features/mini-apps.md',
    purpose: 'Get on a community plugin asks first: what runs, where from, and for whom',
    scenario: 'store-consent',
    start: 'home',
  },
  'store/sources': {
    guide: 'features/mini-apps.md',
    purpose: 'Sources with one Add source dialog that reads the address it is given',
    scenario: 'store-sources',
    start: 'home',
  },
  'store/search': {
    guide: 'features/mini-apps.md',
    purpose: 'Searching the Store: packages and what is inside them, with filters',
    scenario: 'store-search',
    start: 'home',
  },
  'store/search-wide': {
    guide: 'features/store.md',
    purpose: 'The Store alone in the window, searching: packages and what is inside them',
    scenario: 'store-search-wide',
    start: 'home',
  },
  'store/installed': {
    guide: 'features/mini-apps.md',
    purpose: 'The Library lists every install with its scope, version and enabled switch',
    scenario: 'store-installed',
    start: 'home',
  },
  'store/commands': {
    guide: 'features/mini-apps.md',
    purpose: 'The Commands shelf lists each command with the package it comes from',
    scenario: 'store-commands',
    start: 'home',
  },
  'store/yours': {
    guide: 'features/store.md',
    purpose: 'Yours lists the skill and the MCP server you wrote, each with Add on top',
    scenario: 'store-yours',
    start: 'home',
  },
  'store/archive-unused': {
    guide: 'features/skills.md',
    purpose: 'Archive unused on Yours previews which skills are archived and why before it does',
    scenario: 'store-archive-unused',
    start: 'home',
  },
  'store/mcp-settings': {
    guide: 'features/mcp.md',
    purpose: 'An MCP server’s Settings tab: how it connects, secrets that only say they are set',
    scenario: 'store-mcp-settings',
    start: 'home',
  },
  'store/for-your-work': {
    guide: 'features/store.md',
    purpose:
      'Discover leads with Start here, then For your work: packages that suit the project and the installs, none already installed',
    scenario: 'for-your-work',
    start: 'home',
  },
  'store/for-your-work-all': {
    guide: 'features/store.md',
    purpose: 'See all on For your work opens every recommendation, best first',
    scenario: 'for-your-work-all',
    start: 'home',
  },
  'plugins/workbenches': {
    guide: 'extending/mini-apps.md',
    purpose: 'Available workspace tools and how to open them',
    scenario: 'catalog',
  },
  'composer/status-line': {
    guide: 'extending/claude-code-settings.md',
    purpose:
      'A statusLine command of the project’s settings prints two colored rows with a link, drawn under the message box',
    scenario: 'status-line',
    start: 'home',
  },
  'composer/mcp-prompts': {
    guide: 'features/mcp.md',
    purpose:
      'Typing /mcp__release lists the connected MCP server’s prompts in the slash menu, as Claude Code names them',
    scenario: 'mcp-prompts',
    start: 'home',
  },
  'composer/plugin-waiting': {
    guide: 'extending/claude-code-plugins.md',
    purpose:
      'A plugin of the project that waits for its OK is one row in the slash menu that opens its Store page',
    scenario: 'plugin-waiting',
    start: 'home',
  },
  'workspace/command-palette': {
    guide: 'features/keyboard-shortcuts.md',
    purpose: 'Find a command from a populated workspace',
    scenario: 'palette',
  },
  'workspace/first-run': {
    guide: 'features/workspace.md',
    purpose:
      'A first launch with no saved layout: panels collapsed, a new chat open and setup over it',
    scenario: 'first-run',
    firstRun: true,
  },
  'workspace/editor-grid': {
    guide: 'features/workspace.md',
    purpose: 'Source and terminal tabs in one main column beside the conversation',
    scenario: 'editor',
  },
  'workspace/hero': {
    guide: 'getting-started/what-is-localix.md',
    purpose: 'A real passing fixture test run beside the seeded conversation',
    scenario: 'editor',
  },
}
export const retainedShots = {
  'plugins/agent-build': 'Working checklist fixture; extending/build-with-the-agent.md',
}
// Historical comparisons, theme demonstrations and transient boot states are not feature evidence.
export const archiveOnly = [
  'workspace/workbench-before',
  'workspace/workbench-after',
  'workspace/workbench-light',
  'workspace/service-starting',
  'workspace/service-error',
  'workspace/board-shortcuts',
]
