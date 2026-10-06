import { lazy } from 'react'
import { Bot, FolderTree, History } from 'lucide-react'
import { ClaudeMark, CodexMark } from '@localixai/kit/coding-agent-marks'
import type { PluginUiHost } from '@localixai/plugin-sdk/ui'
import { resourceMessageBindingDraft } from '@localixai/plugin-sdk/ui'
import { EXTERNAL_NAMESPACE, parseExternalResource } from './model/sessionResource'

const Transcript = lazy(() => import('./ui/ExternalTranscript'))
const HistoryTab = lazy(() => import('./ui/ExternalHistoryTab'))

export function registerUi(host: PluginUiHost): void {
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
      tools: ['external_agent_sessions'],
      nextSteps: ['Read the linked session and its tool results with external_agent_sessions.'],
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
      'claude-code': ClaudeMark,
      codex: CodexMark,
      'gemini-cli': Bot,
      opencode: Bot,
      'github-copilot': Bot,
      hermes: Bot,
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
