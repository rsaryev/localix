import type { PluginShowcase } from './homeContentTypes'

/**
 * The bundled plugins that add a workbench you can open. Three more add agent capability with no
 * workbench (Code Review, Deliverables, Webhook Notifier), so they have nothing to show here and
 * live in the inventory at `docs/extending/plugins.md#bundled-plugins`. The Kanban board and
 * Project Space are bundled plugins too, and have their own sections rather than a card. The five
 * board games share one card, linked to the guide that documents how the agent plays.
 */
export const PLUGINS: PluginShowcase[] = [
  {
    title: 'Database',
    body: 'Explore schemas and data across SQL and non-SQL engines, run queries, and attach bounded database context directly to the conversation.',
    slug: 'features--database',
    anchor: 'what-you-can-do',
  },
  {
    title: 'DevOps',
    body: 'Inspect Docker containers and Kubernetes resources and follow logs. Dangerous commands ask before they run, by default.',
    slug: 'features--devops',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Git',
    body: 'Review changes, resolve conflicts, and move through history and branches on a workspace the agent shares, so a diff is context rather than pasted text.',
    slug: 'features--source-control',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Code Graph',
    body: 'A navigable map of the project: files and symbols joined by imports, calls, and inheritance, so you can see what depends on something before you change it.',
    slug: 'features--code-graph',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Reader',
    body: 'Read EPUB, PDF, MOBI, FB2, CBZ, Markdown, and HTML with annotations, and add the visible chapter or a selection to the conversation as context.',
    slug: 'features--reader',
    anchor: 'agent-context-and-links',
  },
  {
    title: 'Trading',
    body: 'Research public markets with live charts, indicators, order books, and trades. Read-only by design—no accounts, orders, or execution.',
    slug: 'features--trading',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Learning Studio',
    body: 'Build and study structured courses with lessons, quizzes, and practice. Progress and course context stay within the session that owns them.',
    slug: 'features--learning-loop',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Documents',
    body: 'Open PDFs and Office files and explore spreadsheets as filterable tables.',
    slug: 'features--documents',
    anchor: 'capabilities',
  },
  {
    title: 'API Client',
    body: 'Build, import, parameterize, and send saved HTTP requests. Keep credentials as vault-backed references and attach API context to the conversation.',
    slug: 'features--api',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Games',
    body: 'Chess, Checkers, Battleship, Tic-tac-toe, and 2048, played against the agent on a board that lives in the chat.',
    slug: 'features--game-2048',
    anchor: 'when-the-agent-plays',
  },
]
