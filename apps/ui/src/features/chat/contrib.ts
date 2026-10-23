import type { PluginUiHost, UiAnchorContribution } from '@localixai/mini-app-sdk/ui'
import { parseLocalixResourceUri } from '@localixai/mini-app-sdk/ui'
import { lazy } from 'react'
import { ClipboardList } from 'lucide-react'
import { PLAN_WORK_KIND } from '@/entities/chat/model/plans'

export const chatResourceAnchor: UiAnchorContribution = {
  id: 'chat-resources',
  namespaces: ['chat'],
  resolve(uri) {
    const parsed = parseLocalixResourceUri(uri)
    if (parsed?.provider !== 'chat' || Array.from(parsed.query).length > 0) return null
    const segments = parsed.segments.map((segment) => decodeURIComponent(segment))
    const [kind, first, second] = segments
    if (kind === 'session' && first && segments.length === 2) {
      return { kind: 'session', sessionId: first }
    }
    if (kind === 'project' && first && segments.length === 2) {
      return { kind: 'project', projectId: first }
    }
    if (kind === 'message' && first && second && segments.length === 3) {
      return { kind: 'message', sessionId: first, messageId: second }
    }
    return null
  },
}

/** Loaded when a plan tab first renders: most sessions never present a plan. */
const PlanView = lazy(() =>
  import('@/entities/chat/ui/plan/PlanView').then((module) => ({ default: module.PlanView })),
)

export function registerUi(host: PluginUiHost): void {
  host.anchors.register(chatResourceAnchor)
  // The conversation's plan tab (`model/plans.ts` `openPlanTab`). Session-scoped: it reads one
  // conversation's plans and writes its comments. Restorable — its payload is two ids, and the
  // tab loads the plans itself rather than relying on the composer having mounted first.
  host.workItems.register({
    kind: PLAN_WORK_KIND,
    Component: PlanView,
    Icon: ClipboardList,
    restorable: true,
    scope: 'session',
  })
}
