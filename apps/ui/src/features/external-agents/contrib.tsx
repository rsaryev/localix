import { lazy } from 'react'
import { FolderTree, History } from 'lucide-react'
import { externalAgentPresentation } from '@/shared/ui/externalAgentPresentation'
import { LinkedAgentTerminalPill } from './ui/LinkedAgentTerminalPill'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { resourceMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import { EXTERNAL_NAMESPACE, parseExternalResource } from './model/sessionResource'

const Transcript = lazy(() => import('./ui/ExternalTranscript'))
const HistoryTab = lazy(() => import('./ui/ExternalHistoryTab'))

export function registerUi(host: MiniAppUiHost): void {
  host.sessionSurfaces.register({ surface: 'composer.context', Component: LinkedAgentTerminalPill })
  host.workItems.register({
    kind: 'external-agent-transcript',
    Component: Transcript,
    Icon: History,
    scope: 'global',
    restorable: false,
    placement: 'aux',
    toMessageBinding: (item) =>
      typeof item.payload?.uri === 'string'
        ? resourceMessageBindingDraft({ uri: item.payload.uri, label: item.title }, 'active-tab')
        : null,
    agentContext: {
      description:
        'A linked external coding-agent transcript. Use its resource session key to investigate further.',
      tools: ['ExternalAgentSessions'],
      nextSteps: ['Read the linked session and its tool results with ExternalAgentSessions.'],
    },
  })
  host.workItems.register({
    kind: 'external-agent-history',
    Component: HistoryTab,
    Icon: History,
    scope: 'global',
    restorable: true,
  })
  host.anchors.register({
    id: 'core:external-agent-resource',
    namespaces: [EXTERNAL_NAMESPACE],
    icons: {
      ...Object.fromEntries(
        ['claude-code', 'codex', 'gemini-cli', 'opencode', 'github-copilot', 'hermes'].map(
          (provider) => [provider, externalAgentPresentation(provider).Icon],
        ),
      ),
      folder: FolderTree,
      session: History,
    },
    resolve: (uri) => {
      const target = parseExternalResource(uri)
      if (!target) return null
      if (target.kind === 'session')
        return {
          kind: 'work-item',
          workKind: 'external-agent-transcript',
          id: `external-agent:${target.key}`,
          title: target.nativeSessionId,
          payload: { key: target.key, uri },
        }
      return {
        kind: 'work-item',
        workKind: 'external-agent-history',
        id: `external-history:${uri}`,
        title: 'External history',
        payload: {
          uri,
          provider: target.kind === 'root' ? undefined : target.provider,
          cwd: target.kind === 'project' ? target.cwd : undefined,
        },
      }
    },
  })
}
