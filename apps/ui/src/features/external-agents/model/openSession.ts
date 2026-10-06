import { Import, Link2, Terminal } from 'lucide-react'
import type { PluginTranscriptAction } from '@localixai/plugin-sdk/ui/runtime'
import { MAX_TRANSCRIPT_EVENTS } from '@localixai/api/external-agent-contracts'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { externalAgentsApi } from '../api'
import { toMessages, type ExternalTranscriptMessage } from './toMessages'
import { backendClient } from '@/shared/api/client'
import { projectsApi } from '@/shared/api/projects-client'
import { useChatStore } from '@/features/chat/model/store'
import { rememberTranscript } from '@/features/chat/model/openTranscript'
import { openCommandTerminal } from '@/features/terminal/model/terminalTabs'
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

export async function importExternalSession(source: Source) {
  const slice = await externalAgentsApi.items(source.key, MAX_TRANSCRIPT_EVENTS, true)
  const project = source.cwd
    ? (await projectsApi.resolveProjectByPath(source.cwd)).project
    : undefined
  const imported = await backendClient.importSession({
    title: source.title,
    messages: externalSessionMessages(slice),
    ...(project ? { projectId: project.id } : {}),
  })
  await useChatStore.getState().loadProjects()
  return { sessionId: imported.id, projectId: imported.projectId }
}

export async function prepareExternalTranscript(source: Source, owningSessionId: string | null) {
  const slice = await externalAgentsApi.items(source.key, MAX_TRANSCRIPT_EVENTS, true)
  const id = `external-agent:${source.key}`
  const actions: PluginTranscriptAction[] = [
    {
      label: 'Import to Localix',
      pendingLabel: 'Importing…',
      icon: Import,
      errorLabel: 'Could not import this conversation',
      run: () => importExternalSession(source),
    },
  ]
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
        // A preview creates no Localix session. Only a requested terminal needs an owner.
        let sessionId = owningSessionId
        let destination: { sessionId: string; projectId: string } | undefined
        if (!sessionId) {
          const project = source.cwd
            ? (await projectsApi.resolveProjectByPath(source.cwd)).project
            : undefined
          const created = await backendClient.createSession(
            project ? { projectId: project.id } : {},
          )
          sessionId = created.id
          await useChatStore.getState().loadProjects()
          destination = { sessionId, projectId: created.projectId }
        }
        await openCommandTerminal(sessionId, resume.command, resume.providerName)
        return destination
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
