import { afterAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { defaultProjectDir } from '../projects/default-project'
import { resolveBaseSessionCwd, sandboxCwd, type BaseCwdSession } from './session-cwd'

/**
 * These exercise the REAL sandbox root, because the path is the thing under test. Each created
 * directory is recorded and removed at the end, so the tests do not litter `~/.localix/workspace`.
 */
const created: string[] = []
afterAll(async () => {
  for (const dir of created) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

const session = (over: Partial<BaseCwdSession> = {}): BaseCwdSession => ({
  id: 's1',
  projectId: null,
  rootSessionId: null,
  ...over,
})

describe('resolveBaseSessionCwd', () => {
  test('project working dir wins over sandbox', async () => {
    const dir = await resolveBaseSessionCwd(
      { getProjectWorkingDir: async () => '/repo/proj' },
      'u1',
      session({ projectId: 'p1' }),
    )
    expect(dir).toBe('/repo/proj')
  })

  test('falls back to the session sandbox when no project', async () => {
    const s = session({ id: `noproject-${Date.now()}` })
    const dir = await resolveBaseSessionCwd({ getProjectWorkingDir: async () => null }, 'u1', s)
    created.push(dir)
    expect(dir).toBe(sandboxCwd(s))
    expect(dir).toBe(path.join(homedir(), '.localix', 'workspace', s.id))
  })

  test('sandbox keys off rootSessionId for child sessions', async () => {
    const s = session({ id: 'child', rootSessionId: 'root' })
    expect(sandboxCwd(s)).toBe(path.join(homedir(), '.localix', 'workspace', 'root'))
  })

  test('the DEFAULT project is a parent of sandboxes, not a shared cwd', async () => {
    // The default project exists to give an unfiled chat a capability scope. Answering its
    // working dir here would put every such chat in ONE directory — a thousand sessions in
    // one folder, which is the landfill the sandbox already solved.
    const s = session({ id: `scratch-${Date.now()}`, projectId: 'PRJ-default' })
    const dir = await resolveBaseSessionCwd(
      { getProjectWorkingDir: async () => defaultProjectDir() },
      'u1',
      s,
    )
    created.push(dir)
    expect(dir).toBe(sandboxCwd(s))
    expect(path.dirname(dir)).toBe(defaultProjectDir())
  })
})
