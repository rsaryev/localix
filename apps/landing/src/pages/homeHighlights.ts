import type { FeatureRow } from './homeContentTypes'

export type HighlightId =
  | 'plugins'
  | 'context'
  | 'browser'
  | 'external'
  | 'team'
  | 'space'
  | 'git'
  | 'graph'
  | 'kanban'
  | 'database'
  | 'api'
  | 'devops'

export interface HomepageHighlight extends Omit<FeatureRow, 'kicker'> {
  id: HighlightId
  wide?: boolean
}

/** Distinctive workflows and the development workbenches that ship with Localix. */
export const HOMEPAGE_HIGHLIGHTS: HomepageHighlight[] = [
  {
    id: 'plugins',
    wide: true,
    title: 'Build your own workbench',
    body: 'Describe a workflow. Your agent builds a native plugin with its own interface, tools, and tests. Verified builds appear in your workspace.',
    slug: 'extending--build-with-the-agent',
    anchor: 'how-it-works',
  },
  {
    id: 'browser',
    title: 'Point at the interface',
    body: 'Attach the exact element with its selector, styles, and source hint. Your agent inspects and works in the same preview.',
    slug: 'features--visual-feedback',
    anchor: 'let-the-agent-drive-the-preview',
  },
  {
    id: 'context',
    title: 'Context you can see',
    body: 'Files, selections, diffs, and workbench resources join your message as inspectable context. Keep what matters before you send.',
    slug: 'features--workspace',
    anchor: 'explicit-and-automatic-context',
  },
  {
    id: 'team',
    wide: true,
    title: 'One chat. A whole team.',
    body: 'Bring specialists into one conversation. Address a teammate or let agents hand off the turn. Each keeps its own role, rules, and model.',
    slug: 'features--conversations',
    anchor: 'passing-work-between-agents',
  },
  {
    id: 'external',
    wide: true,
    title: 'Your coding agent, in your workspace',
    body: 'Run an installed coding-agent CLI beside your files. Browse its native history, resume sessions, and link its transcript into chat.',
    slug: 'features--external-agents',
    anchor: 'sessions-and-projects',
  },
  {
    id: 'space',
    title: 'Think on a shared canvas',
    body: 'Arrange notes, diagrams, and live file cards in Project Space. Your agent can read, edit, and arrange the same board.',
    slug: 'features--project-space',
    anchor: 'what-you-can-do',
  },
  {
    id: 'git',
    title: 'Git',
    body: 'Review diffs, stage changes, resolve conflicts, and manage branches beside the conversation.',
    slug: 'features--source-control',
    anchor: 'what-you-can-do',
  },
  {
    id: 'graph',
    title: 'Code Graph',
    body: 'Follow imports, calls, and inheritance from a project map into the source. Share the view with your agent.',
    slug: 'features--code-graph',
    anchor: 'what-you-can-do',
  },
  {
    id: 'kanban',
    title: 'Kanban',
    body: 'Keep tasks, dependencies, owners, and blockers on your chat’s board. You decide when work starts.',
    slug: 'features--task-board',
    anchor: 'what-you-can-do',
  },
  {
    id: 'database',
    title: 'Database',
    body: 'Explore schemas, run SQL and non-SQL queries, and bring bounded data context into chat.',
    slug: 'features--database',
    anchor: 'what-you-can-do',
  },
  {
    id: 'api',
    title: 'API Client',
    body: 'Build saved HTTP requests, reuse environments and secret references, and inspect responses in place.',
    slug: 'features--api',
    anchor: 'what-you-can-do',
  },
  {
    id: 'devops',
    title: 'DevOps',
    body: 'Inspect Docker and Kubernetes resources, open logs, and keep runtime state beside your code.',
    slug: 'features--devops',
    anchor: 'what-you-can-do',
  },
]
