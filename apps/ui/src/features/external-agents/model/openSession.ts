import { Link2, Terminal } from 'lucide-react'
import type { PluginTranscriptAction } from '@localixai/plugin-sdk/ui/runtime'
import { MAX_TRANSCRIPT_EVENTS } from '@localixai/api/external-agent-contracts'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { externalAgentsApi } from '../api'
import { toMessages, type ExternalTranscriptMessage } from './toMessages'
import { useChatStore } from '@/entities/chat/model/store'
import { rememberTranscript } from '@/entities/chat/model/openTranscript'
import { openOwnedExternalSession } from './createSession'
import { inspector } from '@/shared/lib/inspectorBus'
import { composerBus } from '@/shared/lib/composerBus'
import {
  externalSessionBinding,
  externalSessionUri,
  type ExternalSessionSource,
} from './sessionResource'

type Source = ExternalSessionSource
type Slice = Awaited<ReturnType<typeof externalAgentsApi.items>>

/** Both the viewer and import say when a bounded tail omitted earlier turns. */
export function externalSessionMessages(slice: Slice): ExternalTranscriptMessage[] {
  const messages = toMessages(slice.turns, slice.key)
  if (!slice.withheld && !slice.sourceTruncated) return messages
  const description = slice.sourceTruncated
    ? 'The source exceeded the read limit. These are its latest readable turns.'
    : `Showing the latest ${slice.total - slice.withheld} of ${slice.total} recorded events; ${slice.withheld} earlier events remain in the agent’s history.`
  return [
    { id: `${slice.key}#read-bound`, role: 'assistant', content: `_Localix: ${description}_` },
    ...messages,
  ]
}

export async function prepareExternalTranscript(source: Source, owningSessionId: string | null) {
  const slice = await externalAgentsApi.items(source.key, MAX_TRANSCRIPT_EVENTS, true)
  const id = `external-agent:${source.key}`
  const actions: PluginTranscriptAction[] = []
  const resume = slice.resume
  if (owningSessionId) {
    actions.unshift({
      label: 'Link to chat',
      pendingLabel: 'Linking…',
      icon: Link2,
      run: async () => {
        composerBus.insert({
          sessionId: owningSessionId,
          bindings: [externalSessionBinding(source)],
          focus: false,
        })
      },
    })
  }
  if (resume) {
    actions.push({
      label: `Open in ${resume.providerName}`,
      pendingLabel: 'Opening…',
      icon: Terminal,
      errorLabel: 'Could not open this agent session in a terminal',
      run: async () => {
        return openNativeSessionTerminal(source)
      },
    })
  }
  rememberTranscript({
    id,
    title: source.title,
    messages: externalSessionMessages(slice),
    foreignTools: true,
    actions,
  })
  return id
}

export async function loadExternalSession(key: string): Promise<RosterRow> {
  const page = await externalAgentsApi.roster({ text: key, includeChildren: true })
  const source = page.items.find((row) => row.key === key)
  if (!source) throw new Error('This agent session is no longer available.')
  return source
}

export async function openExternalSession(source: Source, owningSessionId: string | null) {
  const id = await prepareExternalTranscript(source, owningSessionId)
  inspector.openWorkItem({
    workKind: 'external-agent-transcript',
    id,
    title: source.title,
    scope: null,
    payload: {
      transcriptId: id,
      key: source.key,
      uri: externalSessionUri(source.key),
      title: source.title,
      provider: source.provider,
      cwd: source.cwd,
    },
  })
}

async function openNativeSessionTerminal(source: Source) {
  const destination = await externalAgentsApi.attachNative(source.key)
  await useChatStore.getState().loadProjects()
  await openOwnedExternalSession(destination.sessionId)
  return destination
}

/** Native history clicks attach identity to a normal chat and continue the exact CLI session. */
export async function openExternalSessionTerminal(source: Source, _owningSessionId: string | null) {
  return openNativeSessionTerminal(source)
}
