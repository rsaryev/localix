import type { FeatureRow } from './homeContentTypes'

/** Short entry points; the linked guides carry the detailed product contracts. */
export const WORKSPACE_LINKS: FeatureRow[] = [
  {
    title: 'Project Space',
    body: 'Arrange notes, diagrams, and live file cards on a board you share with the agent.',
    slug: 'features--project-space',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Agent browser',
    body: 'Work in the same preview. Point at an element and attach visual feedback.',
    slug: 'features--visual-feedback',
    anchor: 'let-the-agent-drive-the-preview',
  },
]

export const PLATFORM_OVERVIEW: FeatureRow[] = [
  {
    title: 'Model routing',
    body: 'Give conversations, completions, and delegated agents their own model routes.',
    slug: 'features--providers',
    anchor: 'what-you-can-do',
  },
  {
    title: 'Permissions',
    body: 'Allow, ask, or deny tool calls with ordered rules.',
    slug: 'features--permissions',
    anchor: 'permission-contract',
  },
  {
    title: 'Background work',
    body: 'Run scheduled prompts while Localix is open.',
    slug: 'features--loops',
    anchor: 'after-a-restart',
  },
  {
    title: 'External agents',
    body: 'Read, link, or continue sessions from installed coding-agent CLIs.',
    slug: 'features--external-agents',
    anchor: 'sessions-and-projects',
  },
]
