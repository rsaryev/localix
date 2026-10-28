import { lazy } from 'react'
import { NotebookPen } from 'lucide-react'
import { screenUi } from '@localixai/mini-app-sdk/ui/app'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { APP } from '../shared/model'

const App = lazy(() => import('./App').then((module) => ({ default: module.App })))

/**
 * The screen's registration: its tab, its launcher in the rail's overflow, and what the agent is
 * told while it is open. `scope: 'chat'` would give every chat its own tab (for a chat collection).
 */
export const registerUi = screenUi({
  app: APP,
  title: 'Daily Log',
  label: 'Daily Log — what you log each day, against a goal',
  keywords: ['log', 'journal', 'daily', 'goal', 'tracker'],
  Icon: NotebookPen,
  Screen: App,
  loading: <LoadingHint>Opening Daily Log…</LoadingHint>,
  agentContext: {
    description:
      "Daily Log: today's entries and total against the person's daily goal, and the last seven days.",
    tools: [
      'template_log_entry',
      'template_summary',
      'template_find_entries',
      'template_remove_entry',
    ],
    nextSteps: [
      'When the person tells you or shows you something to log, extract title, amount and category and call template_log_entry.',
      'Answer questions about today from the published summary; call template_summary for fresh numbers.',
    ],
  },
})
