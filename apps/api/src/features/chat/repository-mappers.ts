import type { AgentSessionKind } from '../../db'
import { asStringArray } from '../../lib/coerce'
import { safeJsonParse } from '../../lib/json'
import { DEFAULT_PERMISSION_MODE, parsePermissionMode } from '../capabilities/permission-modes'
import { deserializeMessagePayload } from '../../db'
import type { PersistedMessage, SessionSummary } from './contracts'
import type { SessionRecord } from './repository'
import { parseSessionProvenance } from './session-provenance'
import { parseParticipants } from './repository-conversation-participants'

// Row→record mappers for the chat repository. Type-only `SessionRecord` import
// from ./repository is erased at compile time, so there is no runtime import
// cycle (repository.ts imports these mappers as values; this file imports only
// the type back).

export const mapSession = (row: {
  id: string
  user_id: string
  seq?: number
  title: string
  is_pinned: number
  created_at: string
  updated_at: string
  last_message_at: string
  execution_backend: string
  execution_target: string | null
  project_id: string
  parent_session_id: string | null
  root_session_id: string | null
  session_kind: AgentSessionKind
  runtime_status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  source_tool_call_id: string | null
  external_agent_provider?: string | null
  external_agent_session_key?: string | null
  invocation_json: string
  pinned_skills?: string | null
  activated_tools?: string | null
  /** The participants, aggregated to JSON by `participantsJsonColumn`. */
  agents_json?: string | null
  roster_locked?: number
  closed_at?: string | null
  permission_mode?: string | null
  description?: string | null
  avatar?: string | null
  archived_at?: string | null
  task_name?: string | null
}): SessionRecord => ({
  id: row.id,
  userId: row.user_id,
  seq: row.seq ?? 0,
  title: row.title,
  isPinned: row.is_pinned === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMessageAt: row.last_message_at,
  executionBackend: (row.execution_backend ?? 'local') as 'local' | 'ssh' | 'docker',
  executionTarget: row.execution_target ?? null,
  projectId: row.project_id,
  parentSessionId: row.parent_session_id ?? null,
  rootSessionId: row.root_session_id ?? row.id,
  sessionKind: row.session_kind ?? 'chat',
  runtimeStatus: row.runtime_status ?? 'idle',
  ...(row.external_agent_provider ? { externalAgentProvider: row.external_agent_provider } : {}),
  ...(row.external_agent_session_key
    ? { externalAgentSessionKey: row.external_agent_session_key }
    : {}),
  sourceToolCallId: row.source_tool_call_id ?? null,
  provenance: parseSessionProvenance(row.invocation_json),
  agents: parseParticipants(row.agents_json),
  rosterLocked: row.roster_locked === 1,
  closedAt: row.closed_at ?? null,
  permissionMode: parsePermissionMode(row.permission_mode),
  description: row.description ?? null,
  avatar: row.avatar ?? null,
  pinnedSkills: parsePinnedSkills(row.pinned_skills),
  activatedTools: asStringArray(safeJsonParse(row.activated_tools)),
  // The COLUMN is named after the one isolation mechanism that existed when it was added; the
  // domain calls it what it is — which session's isolated directory this session works in. The
  // rename stops here rather than reaching the schema: renaming a live column means an ALTER that
  // re-parses every trigger in the database, and this name buys nothing above the mapper.
  archivedAt: row.archived_at ?? null,
  taskName: row.task_name ?? null,
})

function parsePinnedSkills(raw: string | null | undefined): string[] {
  // asStringArray(null) is [], so the unparseable and absent cases need no branch.
  return asStringArray(safeJsonParse(raw))
}

export const mapMessage = (row: {
  id: string
  session_id: string
  user_id: string
  payload_json: string
  created_at: string
  updated_at: string
}): PersistedMessage => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  payload: deserializeMessagePayload(row.payload_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/**
 * Project a stored session record onto the wire `SessionSummary`. Ephemeral
 * runtime fields (sessionTiming/loops/queuedMessages) start empty and are
 * filled by the live stream — they are not persisted on the record.
 */
export const toSessionSummary = (record: SessionRecord): SessionSummary => ({
  id: record.id,
  seq: record.seq ?? 0,
  title: record.title,
  isPinned: record.isPinned,
  isArchived: record.archivedAt !== null,
  projectId: record.projectId,
  parentSessionId: record.parentSessionId,
  rootSessionId: record.rootSessionId,
  sessionKind: record.sessionKind,
  agents: record.agents,
  rosterLocked: record.rosterLocked,
  closedAt: record.closedAt ?? null,
  permissionMode: record.permissionMode ?? DEFAULT_PERMISSION_MODE,
  description: record.description,
  avatar: record.avatar,
  runtimeStatus: record.runtimeStatus,
  ...(record.externalAgentProvider ? { externalAgentProvider: record.externalAgentProvider } : {}),
  ...(record.externalAgentSessionKey
    ? { externalAgentSessionKey: record.externalAgentSessionKey }
    : {}),
  sourceToolCallId: record.sourceToolCallId,
  pinnedSkills: record.pinnedSkills ?? [],
  sessionTiming: null,
  loops: [],
  work: [],
  queuedMessages: [],
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  lastMessageAt: record.lastMessageAt,
})
