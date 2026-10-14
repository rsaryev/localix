import type { Transaction } from 'kysely'
import type { AppDatabase } from '../../db'
import {
  AGENT_TASK_ROOT_PATH,
  agentTaskPath,
  claimAgentTaskPath,
  deriveAgentTaskSegment,
} from '../agent-core/agent-task-name'
import type { SessionRecord } from './repository-types'

export interface SessionIdentityClaim {
  taskName: string
  rootSessionId: string
}

/** Validate ownership and reserve an address using the same transaction as session insertion. */
export async function claimSessionIdentity(
  exec: Transaction<AppDatabase>,
  record: SessionRecord,
): Promise<SessionIdentityClaim> {
  if (!exec.isTransaction) throw new Error('Session identity claims require an insert transaction')
  // A tree root IS `/root` by definition — no derivation, and nothing to collide with (a second
  // parentless row in one tree would mean two roots, which the unique index refuses on purpose).
  if (!record.parentSessionId)
    return { taskName: AGENT_TASK_ROOT_PATH, rootSessionId: record.rootSessionId ?? record.id }
  const parent = await exec
    .selectFrom('agent_sessions')
    .select(['id', 'root_session_id'])
    .where('id', '=', record.parentSessionId)
    .where('user_id', '=', record.userId)
    .executeTakeFirst()
  if (!parent) throw new Error('Session parent is unavailable')
  const rootSessionId = parent.root_session_id ?? parent.id
  if (record.rootSessionId != null && record.rootSessionId !== rootSessionId)
    throw new Error('Session root does not match its parent tree')
  const rows = await exec
    .selectFrom('agent_sessions')
    .select(['id', 'task_name'])
    .where('user_id', '=', record.userId)
    .where('root_session_id', '=', rootSessionId)
    .where('task_name', 'is not', null)
    .execute()
  const taken = new Set<string>()
  let parentPath = AGENT_TASK_ROOT_PATH
  for (const row of rows) {
    if (!row.task_name) continue
    taken.add(row.task_name)
    if (row.id === record.parentSessionId) parentPath = row.task_name
  }
  return {
    rootSessionId,
    taskName: claimAgentTaskPath(
      agentTaskPath(parentPath, deriveAgentTaskSegment(record.title)),
      taken,
    ),
  }
}
