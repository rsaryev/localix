import type { FeatureRow } from './homeContentTypes'

export const EXTERNAL_FEATURES: FeatureRow[] = [
  {
    kicker: 'Installed on your machine',
    title: 'Your CLI history beside Localix chats',
    body: 'Browse Localix chats and native CLI sessions together in the selected project. Agent icons identify linked sessions; only supported CLIs found on your executable search path appear.',
    slug: 'features--external-agents',
    anchor: 'sessions-and-projects',
  },
  {
    kicker: 'Keep the conversation',
    title: 'Read or continue the native session',
    body: 'Inspect a native transcript in Localix, or open its linked chat and resume the exact CLI session in a terminal. The external conversation stays in the coding agent’s own history.',
    slug: 'features--external-agents',
    anchor: 'native-transcripts',
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
