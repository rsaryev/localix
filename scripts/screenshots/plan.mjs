// A shot is evidence for a user action, never decoration for every document.
export const capturePlan = {
  'agents/edit-command-tokens': {
    guide: 'features/agent-management.md',
    purpose:
      'Agent command flags and values have separate editable crumbs and priority suggestions',
    scenario: 'agent-command',
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
    guide: 'extending/plugins.md',
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
    purpose: 'Standing instructions, memory scope and turn budget in one profile',
    scenario: 'agent',
  },
  'agents/create-from-chat': {
    guide: 'features/agent-management.md',
    purpose:
      'A user’s /agents create command opens the existing scoped form with a populated specialist definition',
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
  'plugins/workbenches': {
    guide: 'extending/plugins.md',
    purpose: 'Available workspace tools and how to open them',
    scenario: 'catalog',
  },
  'workspace/command-palette': {
    guide: 'features/keyboard-shortcuts.md',
    purpose: 'Find a command from a populated workspace',
    scenario: 'palette',
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
  'questions/queued': {
    guide: 'features/hitl.md',
    purpose: 'A durable question waiting above the composer',
    scenario: 'queued',
  },
  'questions/waiting': {
    guide: 'features/hitl.md',
    purpose: 'The question opened for an explicit answer',
    scenario: 'question',
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
