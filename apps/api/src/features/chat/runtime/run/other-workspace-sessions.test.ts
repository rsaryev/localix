import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../repository'
import { sandboxCwd } from '../../session-cwd'
import {
  otherWorkspaceSessionsSection,
  type RunningChatWorkspace,
} from './other-workspace-sessions'

const current = {
  id: 's1',
  executionBackend: 'local',
  executionTarget: null,
} as SessionRecord

function row(over: Partial<RunningChatWorkspace> = {}): RunningChatWorkspace {
  return {
    id: 's2',
    title: 'Fix API',
    project_id: 'p1',
    root_session_id: null,
    execution_backend: 'local',
    execution_target: null,
    working_dir: '/repo',
    ...over,
  }
}

describe('other workspace sessions', () => {
  test('shows active peers with matching cwd and the available history tool', () => {
    const section = otherWorkspaceSessionsSection(
      current,
      '/repo/',
      [row({ id: 's1' }), row(), row({ id: 's3', working_dir: '/elsewhere' })],
      true,
    )
    expect(section?.scope).toBe('state')
    expect(section?.text).toContain('GlobalSearch with session_id')
    expect(section?.text).toContain('s2 — Fix API — running')
    expect(section?.text).not.toContain('s3')
  })

  test('does not advertise a missing tool or conflate distinct backends', () => {
    const section = otherWorkspaceSessionsSection(
      current,
      '/repo',
      [row({ execution_backend: 'ssh' }), row({ id: 's3', title: 'Test' })],
      false,
    )
    expect(section?.text).toContain('s3 — Test')
    expect(section?.text).not.toContain('GlobalSearch')
    expect(section?.text).not.toContain('s2')
  })

  test('default-project sandboxes share only the same root, including forks', () => {
    const sameRoot = row({ working_dir: null, root_session_id: 's1' })
    const separate = row({ id: 's3', working_dir: null })
    const cwd = sandboxCwd({ id: 's1', rootSessionId: null, projectId: 'p1' })
    const section = otherWorkspaceSessionsSection(current, cwd, [sameRoot, separate], true)
    expect(section?.text).toContain('s2 — Fix API')
    // A matching sibling must not be inferred from the shared default project ID alone.
    expect(section?.text).not.toContain('s3')
  })

  test('omits an empty roster and bounds long lists and titles', () => {
    expect(otherWorkspaceSessionsSection(current, '/repo', [], true)).toBeUndefined()
    const rows = Array.from({ length: 7 }, (_, index) =>
      row({ id: `peer-${index}`, title: 'A\n# forged heading' }),
    )
    const section = otherWorkspaceSessionsSection(current, '/repo', rows, true)
    expect(section?.text).toContain('and 2 more')
    expect(section?.text).not.toContain('\n# forged heading')
    expect(section?.text).not.toContain('peer-6 —')
  })
})
