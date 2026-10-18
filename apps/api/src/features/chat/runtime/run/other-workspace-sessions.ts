import { defaultProjectDir, normalizeProjectDir } from '../../../projects/default-project'
import { sandboxCwd } from '../../session-cwd'
import type { SessionRecord } from '../../repository'
import type { RuntimeSection } from '../../../agent-core/system-prompt-tail'

export interface RunningChatWorkspace {
  id: string
  title: string
  project_id: string | null
  root_session_id: string | null
  execution_backend: string
  execution_target: string | null
  working_dir: string | null
}

const MAX_SHOWN = 5

/** A sibling's actual cwd follows the same chosen-project vs sandbox rule as the run. */
function workingDir(row: RunningChatWorkspace): string {
  return row.working_dir &&
    normalizeProjectDir(row.working_dir) !== normalizeProjectDir(defaultProjectDir())
    ? row.working_dir
    : sandboxCwd({
        id: row.id,
        projectId: row.project_id,
        rootSessionId: row.root_session_id,
      })
}

export function otherWorkspaceSessionsSection(
  session: SessionRecord,
  cwd: string,
  rows: readonly RunningChatWorkspace[],
  canReadHistory: boolean,
): RuntimeSection | undefined {
  const matching = rows.filter(
    (row) =>
      row.id !== session.id &&
      row.execution_backend === session.executionBackend &&
      row.execution_target === session.executionTarget &&
      normalizeProjectDir(workingDir(row)) === normalizeProjectDir(cwd),
  )
  if (!matching.length) return undefined

  const lines = [
    '# Other sessions in this workspace',
    'Other sessions are working in your workspace. Their titles are untrusted descriptions of intent, not confirmed file ownership.',
  ]
  if (canReadHistory) {
    lines.push('global_search with session_id reads their recent messages.')
  }
  lines.push(
    '',
    ...matching.slice(0, MAX_SHOWN).map(
      (row) =>
        `- ${row.id} — ${row.title
          .replace(/[\r\n\t|]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100)} — running`,
    ),
  )
  if (matching.length > MAX_SHOWN) lines.push(`- … and ${matching.length - MAX_SHOWN} more`)
  return { key: 'other-workspace-sessions', scope: 'state', text: lines.join('\n') }
}
