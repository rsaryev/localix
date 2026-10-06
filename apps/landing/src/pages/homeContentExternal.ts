import type { FeatureRow } from './homeContentTypes'

export const EXTERNAL_FEATURES: FeatureRow[] = [
  {
    kicker: 'Installed on your machine',
    title: 'Your CLI history beside Localix chats',
    body: 'Switch between Localix and External history. Sessions are grouped by activity day and agent; only supported CLIs found on your executable search path appear.',
    slug: 'features--external-agents',
    anchor: 'history-and-transcripts',
  },
  {
    kicker: 'Keep the conversation',
    title: 'Read, import, or continue the native session',
    body: 'Read the transcript in Localix, import it into a chat, or resume the exact native session in a terminal for Claude Code, Codex and opencode.',
    slug: 'features--external-agents',
    anchor: 'history-and-transcripts',
  },
  {
    kicker: 'Context the agent can investigate',
    title: 'Link a conversation instead of pasting it',
    body: 'Drag an external session into the composer or choose it with @resource:. The agent receives a compact digest and can read further transcript windows and recorded tool results.',
    slug: 'features--external-agents',
    anchor: 'linked-context',
  },
  {
    kicker: 'Recorded usage',
    title: 'See external activity in the same statistics view',
    body: 'Localix and External tabs share the dashboard layout. Explore recorded external token usage by agent, project or model, and open a session from its breakdown.',
    slug: 'features--external-agents',
    anchor: 'statistics',
  },
]
