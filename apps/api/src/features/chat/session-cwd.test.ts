import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { defaultProjectDir } from '../projects/default-project'
import {
  discardSessionSandbox,
  resolveBaseSessionCwd,
  sandboxCwd,
  type BaseCwdSession,
} from './session-cwd'

const exists = async (dir: string) =>
  await stat(dir).then(
    () => true,
    () => false,
  )

/**
 * These exercise the REAL sandbox root, because the path is the thing under test — a fake
 * root would prove the function agrees with itself. So each created directory is recorded
 * and removed at the end: a test that litters `~/.localix/workspace` is the same landfill
 * this feature exists to prevent.
 */
const created: string[] = []
const scratchDir = async (dir: string) => {
  created.push(dir)
  await mkdir(dir, { recursive: true })
  return dir
}
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

describe('discardSessionSandbox', () => {
  const reaper = (projectDir: string | null) => ({ getProjectWorkingDir: async () => projectDir })

  test('removes the scratch directory a deleted chat owned', async () => {
    const s = session({ id: `reap-${Date.now()}`, projectId: 'PRJ-default' })
    const dir = await scratchDir(sandboxCwd(s))
    await writeFile(path.join(dir, 'note.txt'), 'scratch')

    await discardSessionSandbox(reaper(defaultProjectDir()), 'u1', s)
    expect(await exists(dir)).toBe(false)
  })

  test('never touches a chosen project — that directory is the user’s', async () => {
    const s = session({ id: `keep-${Date.now()}`, projectId: 'PRJ-1' })
    const dir = await scratchDir(sandboxCwd(s))

    await discardSessionSandbox(reaper('/repo/proj'), 'u1', s)
    expect(await exists(dir)).toBe(true)
  })

  test('a sub-session leaves the tree’s workspace standing', async () => {
    // A worker/fork/child shares the ROOT session's directory. Reaping it on the child's
    // own deletion would delete the workspace its parent is still working in.
    const root = `root-${Date.now()}`
    const child = session({ id: 'worker', rootSessionId: root, projectId: 'PRJ-default' })
    const dir = await scratchDir(sandboxCwd(child))

    await discardSessionSandbox(reaper(defaultProjectDir()), 'u1', child)
    expect(await exists(dir)).toBe(true)
  })
})
