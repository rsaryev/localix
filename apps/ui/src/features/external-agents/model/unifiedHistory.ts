import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { DEFAULT_AGENT_HANDLE } from '@localixai/api/participant'
import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import type { UiSession } from '@/shared/api/contracts'
import { toUiSessionSummary } from '@/shared/api/converters'

/** Native placeholders are view data only. Opening one attaches its identity to a real chat. */
export function nativeHistoryRows(
  rows: readonly RosterRow[],
  owned: readonly UiSession[],
  project: { id: string; workingDir: string } | undefined,
): { sessions: UiSession[]; sources: Map<string, RosterRow> } {
  const sources = new Map<string, RosterRow>()
  if (!project?.workingDir) return { sessions: [], sources }
  const root = project.workingDir.replace(/\/+$/, '') || '/'
  const known = new Set(owned.map((session) => session.externalAgentSessionKey).filter(Boolean))
  const sessions: UiSession[] = []
  for (const row of rows) {
    if (known.has(row.key) || row.parentNativeSessionId || row.sourcePath.startsWith('terminal:'))
      continue
    if (!row.cwd || !isAtOrUnder(root, row.cwd)) continue
    const id = `native:${row.key}`
    if (sources.has(id)) continue
    sources.set(id, row)
    const updatedAt = new Date(row.updatedAt).toISOString()
    sessions.push({
      ...toUiSessionSummary({
        id,
        seq: 0,
        title: row.title || row.nativeSessionId,
        projectId: project.id,
        parentSessionId: null,
        rootSessionId: null,
        sessionKind: 'chat',
        isPinned: false,
        isArchived: false,
        runtimeStatus: 'idle',
        agents: [
          {
            agentId: DEFAULT_AGENT_ID,
            handle: DEFAULT_AGENT_HANDLE,
            modelId: '',
            providerConnectionId: null,
            reasoningEffort: 'low',
          },
        ],
        rosterLocked: false,
        permissionMode: 'default',
        closedAt: null,
        description: null,
        avatar: null,
        sourceToolCallId: null,
        externalAgentProvider: row.provider,
        externalAgentSessionKey: row.key,
        pinnedSkills: [],
        loops: [],
        work: [],
        queuedMessages: [],
        sessionTiming: null,
        messageCount: row.messageCount ?? 0,
        createdAt: new Date(row.startedAt ?? row.updatedAt).toISOString(),
        updatedAt,
        lastMessageAt: updatedAt,
      }),
      readOnly: true,
    })
  }
  return { sessions, sources }
}
