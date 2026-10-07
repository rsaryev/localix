export interface ShowcaseItem {
  key: string
  label: string
  title: string
  body: string
  shot: string
  slug: string
  alt: string
}

export const WORKFLOWS = [
  {
    key: 'conversations',
    label: 'Team',
    title: 'A team in one conversation',
    body: 'Give agents a role, address them with @handle, and follow their work in one shared transcript.',
    shot: 'conversations/participants',
    slug: 'features--conversations',
    alt: 'Team Lead, Frontend, and QA Engineer reviewing a release in one shared conversation',
  },
  {
    key: 'context',
    label: 'Context',
    title: 'Keep the work in context',
    body: 'Link files, terminals, and live resources to the conversation. Open results right where the work happens.',
    shot: 'context/composer-context',
    slug: 'features--workspace',
    alt: 'An open source file and terminal included in the next message’s context',
  },
  {
    key: 'browser',
    label: 'Browser',
    title: 'A browser for you and your agents',
    body: 'Agents navigate, click, and inspect pages in your browser. Build and test your running app there, together.',
    shot: 'browser/agent-preview',
    slug: 'features--visual-feedback',
    alt: 'A running app open in Localix’s browser beside the agent conversation',
  },
  {
    key: 'external',
    label: 'CLI agents',
    title: 'Your agent, in the terminal',
    body: 'Run Claude Code or Codex beside the chat. Localix agents can read and write to their terminal; CLI history stays native.',
    shot: 'external-agents/history',
    slug: 'features--external-agents',
    alt: 'Claude Code running in its native terminal alongside the Localix conversation',
  },
] as const
