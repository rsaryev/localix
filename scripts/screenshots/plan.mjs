// A shot is evidence for a user action, never decoration for every document.
export const capturePlan = {
  'workspace/terminal-error': {
    guide: 'features/workspace.md',
    purpose: 'A failed terminal retains its error output and offers Restart and Close',
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
    purpose: 'Real source, test output and team conversation together',
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
  'conversations/participants': 'A populated team conversation; features/conversations.md',
  'context/composer-context':
    'Source selection linked to the composer; features/context-checkpoints.md',
  'browser/agent-preview':
    'A real browser preview beside the conversation; features/visual-feedback.md',
  'project-space/board': 'A release plan with a live source file; features/project-space.md',
  'task-board/board': 'Tasks in their current columns; features/task-board.md',
  'task-board/conversation': 'Board and group conversation in the same workspace',
  'plugins/agent-build': 'Working checklist fixture; extending/build-with-the-agent.md',
  'workspace/hero': 'Editor and actual passing tests; getting-started/what-is-localix.md',
}
// Historical comparisons, theme demonstrations and transient boot states are not feature evidence.
export const archiveOnly = [
  'landing/home',
  'landing/showcase',
  'workspace/workbench-before',
  'workspace/workbench-after',
  'workspace/workbench-light',
  'workspace/service-starting',
  'workspace/service-error',
  'workspace/board-shortcuts',
  'resume/editor-light',
  'plugin-template/system-overview',
]
