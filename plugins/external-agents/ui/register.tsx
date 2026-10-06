import { lazy, Suspense } from 'react'
import { FolderTree, ScrollText, Users } from 'lucide-react'

import { localixUriNamespace, type PluginUiHost, type WorkItemLike } from '@localixai/plugin-sdk/ui'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import {
  EXTERNAL_AGENTS_KIND,
  EXTERNAL_AGENT_NAMESPACE,
  parseExternalAgentUri,
} from './model/openSession'
import { AGENT_MARKS } from './model/agentMarks'

/**
 * UI registration for the bundled External Agents workbench. Contributes the roster work item, the
 * rail viewlet that opens the roster and the
 * `external-agent` URI anchor — into the OPEN contrib registries, so core hardcodes this workbench
 * nowhere. Discovered and invoked generically by `shared/contrib/discover.ts` through the
 * `registerUi` export, mirroring the bundled database / trading plugins.
 */

const ExternalAgentsPanelLazy = lazy(() =>
  import('./ExternalAgentsPanel').then((m) => ({ default: m.ExternalAgentsPanel })),
)

function ExternalAgentsBody({ item }: { item: WorkItemLike }) {
  const sessionId = useWorkItemSessionId()
  const requested = item.payload?.providers
  const providers = Array.isArray(requested)
    ? requested.filter((value): value is string => typeof value === 'string')
    : undefined
  // A roster belongs to the chat its transcripts open in; outside one there is nowhere to open them.
  if (!sessionId) return <EmptyHint>Open External Agents from a chat.</EmptyHint>
  return (
    <Suspense fallback={<LoadingHint>Opening External Agents…</LoadingHint>}>
      <ExternalAgentsPanelLazy requestedProviders={providers} />
    </Suspense>
  )
}

let registered = false

export function registerUi(host: PluginUiHost): void {
  if (registered) return
  registered = true

  // A singleton tab PER CHAT. The roster's list is machine-wide, but opening a row puts its
  // transcript in a chat's workspace, and only the roster's own chat can say which; registered
  // 'global', it had none to name. The fixed id still lets open-or-reveal dedupe it within a chat
  // instead of stacking one tab per activation.
  host.workItems.register({
    kind: EXTERNAL_AGENTS_KIND,
    Component: ExternalAgentsBody,
    Icon: Users,
    restorable: true,
    agentContext: {
      description: 'External coding-agent sessions and their current status.',
      tools: ['external_agent_sessions'],
      nextSteps: [
        'List or inspect sessions with external_agent_sessions.',
        'Resume or manage the session the user selected.',
      ],
    },
  })

  host.railViewlets.register({
    kind: EXTERNAL_AGENTS_KIND,
    Icon: Users,
    label: 'External Agents',
    title: 'External Agents',
    defaultArea: 'overflow',
    keywords: [
      'agent',
      'sessions',
      'external',
      'claude code',
      'codex',
      'opencode',
      'gemini',
      'delegation',
      'transcript',
      'history',
    ],
  })

  // One resolution for the whole namespace, so a `localix://resource/external-agent/…` URI opens
  // the same surface however it was reached — a composer chip, `/open`, a search hit, or a tool's
  // navigation action.
  host.anchors.register({
    id: 'external-agents:session-anchor',
    namespaces: [EXTERNAL_AGENT_NAMESPACE],
    // Keyed by the `icon` values the backend's resource tree mints (an adapter id per provider
    // node, `folder` per project) — a glyph vocabulary, not a second URI grammar. The provider
    // glyphs are the agents' real marks, shared with the terminal profiles: two providers wearing
    // the same lucide terminal made a provider row identifiable only by reading it.
    icons: {
      ...AGENT_MARKS,
      folder: FolderTree,
      session: ScrollText,
    },
    resolve: (uri) => {
      const target = parseExternalAgentUri(uri)
      // Ownership guard: a `localix://resource/db/…` or another plugin's resource URI must fall through to its own
      // anchor rather than land on this roster.
      if (localixUriNamespace(uri) !== EXTERNAL_AGENT_NAMESPACE) return null
      // Provider and project levels are containers, and the roster IS the container view — opened
      // narrowed to the provider the URI named. An explicitly empty list clears a stale narrowing
      // on the singleton tab rather than leaving it filtered to whatever it was last opened for.
      return {
        kind: 'work-item',
        workKind: EXTERNAL_AGENTS_KIND,
        id: EXTERNAL_AGENTS_KIND,
        title: 'External Agents',
        payload: { providers: target && target.kind !== 'root' ? [target.provider] : [] },
      }
    },
  })
}
