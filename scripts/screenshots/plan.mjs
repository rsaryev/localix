// A shot is evidence for a user action, never decoration for every document.
export const capturePlan = {
  'agents/island-quick-chat': {
    guide: 'features/agent-companion.md',
    purpose:
      'An immediately focused quick request retains its draft and attachment state through folding',
    scenario: 'island-quick-chat',
  },
  'agents/island-expanded': {
    guide: 'features/agent-companion.md',
    purpose: 'With nothing waiting, the island opens a content-sized, focused composer',
    scenario: 'island-expanded',
  },
  'agents/island-question': {
    guide: 'features/agent-companion.md',
    purpose: 'A live agent question blocks its run, stays pending when folded and reopens inline',
    scenario: 'island-question',
  },
  'agents/island-quick-chat-light': {
    guide: 'features/agent-companion.md',
    purpose: 'The light island focuses a readable field and retains the draft across folding',
    scenario: 'island-quick-chat',
    theme: 'light',
  },
  'agents/island-question-light': {
    guide: 'features/agent-companion.md',
    purpose: 'A light question focuses the answer field and remains pending across folding',
    scenario: 'island-question',
    theme: 'light',
  },
  'agents/island-notch': {
    guide: 'features/agent-companion.md',
    purpose: 'On a notched display the toolbar clears the cutout and the island keeps one width',
    scenario: 'island-notch',
    notch: { compactWidth: 200, compactHeight: 32, notchWidth: 200, notchHeight: 32 },
  },
  'agents/edit-command-tokens': {
    guide: 'features/agent-management.md',
    purpose:
      'Agent command flags and values have separate editable crumbs and priority suggestions',
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
  'task-board/board': {
    guide: 'features/task-board.md',
    purpose: 'Four seeded cards with a real keyboard move persisted from Backlog to Ready',
    scenario: 'kanban-board',
  },
  'task-board/conversation': {
    guide: 'features/task-board.md',
    purpose: 'The same chat-owned board after a keyboard move beside its seeded conversation',
    scenario: 'kanban-conversation',
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
  'conversations/participants': {
    guide: 'features/conversations.md',
    purpose:
      'Three seeded participants, the selected one driving the composer model, and the per-participant usage in the session total',
    scenario: 'participants',
  },
  'conversations/apply-model-to-all': {
    guide: 'features/conversations.md',
    purpose:
      'A group on two models and two reasoning levels offers one model and level for all agents',
    scenario: 'party-route',
  },
  'conversations/model-command-steps': {
    guide: 'features/conversations.md',
    purpose:
      '/model walks Agents, Provider and Model as composer steps with crumbs back to each step',
    scenario: 'model-command',
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
  'trading/market-chart': {
    guide: 'features/trading.md',
    purpose: 'A live public BTC/USD chart from Kraken',
    scenario: 'trading',
    scope: 'platform',
  },
  'system/overview': {
    guide: 'extending/mini-apps.md',
    purpose: 'Real OS metrics with a filtered process list',
    scenario: 'system-overview',
    scope: 'platform',
  },
  'kubernetes/pod-logs': {
    guide: 'features/kubernetes.md',
    purpose: 'Live logs from an isolated running nginx pod',
    scenario: 'kubernetes',
    scope: 'platform',
    requires: 'LOCALIX_CAPTURE_KUBERNETES',
  },
  'external-agents/history': {
    guide: 'features/external-agents.md',
    purpose: 'Real Claude Code terminal beside the Localix conversation',
    scenario: 'external-terminal',
    scope: 'external',
    requires: 'LOCALIX_CAPTURE_CLAUDE',
  },
  'code-graph/project': {
    guide: 'features/code-graph.md',
    purpose: 'Function callers and callees in a real project graph',
    scenario: 'code-graph',
    scope: 'platform',
  },
  'source-control/review': {
    guide: 'features/source-control.md',
    purpose: 'A working tree diff beside commit controls',
    scenario: 'git',
    scope: 'platform',
  },
  'learning/course': {
    guide: 'features/learning-loop.md',
    purpose: 'A course concept with quiz and practice',
    scenario: 'learning',
    scope: 'platform',
  },
  'games/2048': {
    guide: 'features/game-2048.md',
    purpose: 'A real board after keyboard moves',
    scenario: 'game-2048',
    scope: 'platform',
  },
  'games/chess': {
    guide: 'features/games.md',
    purpose: 'A legal demo position and available bishop moves',
    scenario: 'chess',
    scope: 'platform',
  },
  'games/checkers': {
    guide: 'features/games.md',
    purpose: 'A legal demo position and available piece moves',
    scenario: 'checkers',
    scope: 'platform',
  },
  'games/battleship': {
    guide: 'features/games.md',
    purpose: 'A legal demo fleet with a real ship-sinking shot',
    scenario: 'battleship',
    scope: 'platform',
  },
  'games/rock-paper-scissors': {
    guide: 'features/games.md',
    purpose: 'A sealed agent move revealed by a real pick, with its digest checked',
    scenario: 'rock-paper-scissors',
    scope: 'platform',
  },
  'games/tic-tac-toe': {
    guide: 'features/games.md',
    purpose: 'A real winning move from a saved demo position',
    scenario: 'tic-tac-toe',
    scope: 'platform',
  },
  'api/request-response': {
    guide: 'features/api.md',
    purpose: 'A saved HTTP request and its real JSON response',
    scenario: 'api-client',
  },
  'documents/viewer': {
    guide: 'features/documents.md',
    purpose: 'A native table viewer with release checks',
    scenario: 'documents',
  },
  'reader/document': {
    guide: 'features/reader.md',
    purpose: 'A local reading document and chapter navigation',
    scenario: 'reader',
  },
  'agents/context-and-limits': {
    guide: 'features/agents.md',
    purpose: 'An agent’s page in the Store: standing instructions, memory scope and turn budget',
    scenario: 'agent',
  },
  'agents/create-from-chat': {
    guide: 'features/agent-management.md',
    purpose:
      'A user’s /agents create command opens the Store’s Add agent form with the specialist’s name and description filled in',
    scenario: 'agent-management',
  },
  'resume/editor-wide': {
    guide: 'features/resumes.md',
    purpose: 'Finished document beside the editable structured fields',
    scenario: 'resume',
  },
  'resume/library': { purpose: 'Choose an existing demo resume', scenario: 'resume-library' },
  'project-space/answer-components': {
    guide: 'features/project-space.md',
    purpose: 'Rendered answer components on the editable board',
    scenario: 'answer-board',
  },
  'project-space/text-and-lines': {
    guide: 'features/project-space.md',
    purpose:
      'A release flow with formatted shape labels, captioned elbow connectors and styled sticky notes',
    scenario: 'diagram-board',
  },
  'database/console': {
    guide: 'features/database.md',
    purpose: 'A real SQLite query and its result rows',
    scenario: 'database',
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
    guide: 'features/conversations.md',
    purpose:
      'A reply a restart cut off: a quiet marker in the transcript, Continue above the composer',
    scenario: 'unfinished-reply',
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
  'store/mcp-settings': {
    guide: 'features/mcp.md',
    purpose: 'An MCP server’s Settings tab: how it connects, secrets that only say they are set',
    scenario: 'store-mcp-settings',
    start: 'home',
  },
  'tools/codemode-card': {
    guide: 'features/tools.md',
    purpose: 'One script run: its calls with their files, outcome and time, and its JSON report',
    scenario: 'codemode-card',
    start: 'project',
  },
  'plugins/workbenches': {
    guide: 'extending/mini-apps.md',
    purpose: 'Available workspace tools and how to open them',
    scenario: 'catalog',
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
    purpose: 'Source and terminal tabs in one main column beside the team conversation',
    scenario: 'editor',
  },
  'workspace/hero': {
    guide: 'getting-started/what-is-localix.md',
    purpose: 'A real passing fixture test run beside the seeded team conversation',
    scenario: 'editor',
  },
  'devops/containers': {
    guide: 'features/devops.md',
    purpose: 'A running demo container with live logs and lifecycle controls',
    scenario: 'containers',
  },
}
export const retainedShots = {
  'project-space/board': 'A release plan with a live source file; features/project-space.md',
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
