import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMemoryTool } from './tools/memory/memory'
import { createMemoryRepository, type MemoryRepository } from '../memory/repository'

async function createTestDb() {
  const db = createDatabase() // in-memory
  await migrateToLatest(db)
  return db
}

// Memory is file-backed: each test gets its own temp memories dir.
async function createTestRepo(): Promise<MemoryRepository> {
  const db = await createTestDb()
  const baseDir = await mkdtemp(path.join(tmpdir(), 'localix-mem-'))
  return createMemoryRepository(db, { baseDir })
}

describe('memory tool', () => {
  test('set stores a value and get retrieves it', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    const setResult = await tool.execute('tc_1', {
      action: 'set',
      key: 'preferred_language',
      value: 'TypeScript',
    })
    expect(setResult.content).toBe('Memory saved: "preferred_language" (global)')

    const getResult = await tool.execute('tc_2', { action: 'get', key: 'preferred_language' })
    expect(getResult.content).toBe('TypeScript')
  })

  test('get returns not found message for missing key', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    const result = await tool.execute('tc_1', { action: 'get', key: 'missing_key' })
    expect(result.content).toContain('No memory found')
  })

  test('set upserts on duplicate key', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    await tool.execute('tc_1', { action: 'set', key: 'user_role', value: 'developer' })
    await tool.execute('tc_2', { action: 'set', key: 'user_role', value: 'admin' })

    const result = await tool.execute('tc_3', { action: 'get', key: 'user_role' })
    expect(result.content).toBe('admin')
  })

  test('list returns all keys for user', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    await tool.execute('tc_1', { action: 'set', key: 'lang', value: 'TypeScript' })
    await tool.execute('tc_2', { action: 'set', key: 'theme', value: 'dark' })

    const result = await tool.execute('tc_3', { action: 'list' })
    const parsed = JSON.parse(result.content)
    expect(parsed).toHaveLength(2)
    expect(parsed.find((r: { key: string }) => r.key === 'lang').value).toBe('TypeScript')
    expect(parsed.find((r: { key: string }) => r.key === 'theme').value).toBe('dark')
  })

  test('list returns empty message when no memories', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    const result = await tool.execute('tc_1', { action: 'list' })
    expect(result.content).toBe('No memories stored.')
  })

  test('delete removes a key', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    await tool.execute('tc_1', { action: 'set', key: 'temp', value: 'data' })
    const delResult = await tool.execute('tc_2', { action: 'delete', key: 'temp' })
    expect(delResult.content).toBe('Memory deleted: "temp"')

    const getResult = await tool.execute('tc_3', { action: 'get', key: 'temp' })
    expect(getResult.content).toContain('No memory found')
  })

  test('delete returns not found for missing key', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    const result = await tool.execute('tc_1', { action: 'delete', key: 'nonexistent' })
    expect(result.content).toContain('No memory found')
  })

  test('memories are isolated per user', async () => {
    const repo = await createTestRepo()
    const tool1 = createMemoryTool(repo, 'user_1')
    const tool2 = createMemoryTool(repo, 'user_2')

    await tool1.execute('tc_1', { action: 'set', key: 'secret', value: 'user1_secret' })

    const result = await tool2.execute('tc_2', { action: 'get', key: 'secret' })
    expect(result.content).toContain('No memory found')
  })

  test('memories are isolated per project, but global memories are shared', async () => {
    const repo = await createTestRepo()
    const projA = createMemoryTool(repo, 'user_1', 'project-a')
    const projB = createMemoryTool(repo, 'user_1', 'project-b')
    const global = createMemoryTool(repo, 'user_1') // no project → global

    await projA.execute('t1', { action: 'set', key: 'deploy', value: 'A-deploy' })
    await global.execute('t2', { action: 'set', key: 'name', value: 'Rustam' })

    // Project A sees its own memory; project B does not.
    expect((await projA.execute('t3', { action: 'get', key: 'deploy' })).content).toBe('A-deploy')
    expect((await projB.execute('t4', { action: 'get', key: 'deploy' })).content).toContain(
      'No memory found',
    )

    // Both projects see the global memory.
    expect((await projA.execute('t5', { action: 'get', key: 'name' })).content).toBe('Rustam')
    expect((await projB.execute('t6', { action: 'get', key: 'name' })).content).toBe('Rustam')

    // Same key can hold different values in different projects.
    await projB.execute('t7', { action: 'set', key: 'deploy', value: 'B-deploy' })
    expect((await projA.execute('t8', { action: 'get', key: 'deploy' })).content).toBe('A-deploy')
    expect((await projB.execute('t9', { action: 'get', key: 'deploy' })).content).toBe('B-deploy')

    // Project-scoped value takes precedence over a global one with the same key.
    await global.execute('t10', { action: 'set', key: 'deploy', value: 'global-deploy' })
    expect((await projA.execute('t11', { action: 'get', key: 'deploy' })).content).toBe('A-deploy')
  })

  test('set over the char budget returns a tool error with usage, and writes nothing', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1')

    await tool.execute('t1', { action: 'set', key: 'big_note', value: 'x'.repeat(2000) })
    const result = await tool.execute('t2', {
      action: 'set',
      key: 'overflow',
      value: 'y'.repeat(500),
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Memory budget exceeded')
    expect(result.content).toContain('2,200 chars')
    expect(result.content).toContain('big_note')

    // The rejected key was never written; the existing one is intact.
    expect((await tool.execute('t3', { action: 'get', key: 'overflow' })).content).toContain(
      'No memory found',
    )
    expect((await tool.execute('t4', { action: 'get', key: 'big_note' })).content).toBe(
      'x'.repeat(2000),
    )
  })

  test('in a no-project session, a DEFAULT set lands in session scope (not global) — no cross-session leak', async () => {
    const repo = await createTestRepo()
    // The real-world leak case: a session with an id but no project. A default set
    // (no scope) used to fall back to GLOBAL and surface in every other session.
    const here = createMemoryTool(repo, 'user_1', null, 'sess-1')
    const res = await here.execute('t1', {
      action: 'set',
      key: 'project-2048',
      value: 'built with React/Vite',
    })
    expect(res.content).toBe('Memory saved: "project-2048" (session)')

    // A different session (and a fresh global-only view) must NOT see it.
    const other = createMemoryTool(repo, 'user_1', null, 'sess-2')
    expect((await other.execute('t2', { action: 'get', key: 'project-2048' })).content).toContain(
      'No memory found',
    )
  })

  test('scope:"global" is still honored explicitly and is shared across sessions', async () => {
    const repo = await createTestRepo()
    const s1 = createMemoryTool(repo, 'user_1', null, 'sess-1')
    const setRes = await s1.execute('t1', {
      action: 'set',
      key: 'role',
      value: 'backend dev',
      scope: 'global',
    })
    expect(setRes.content).toBe('Memory saved: "role" (global)')
    const s2 = createMemoryTool(repo, 'user_1', null, 'sess-2')
    expect((await s2.execute('t2', { action: 'get', key: 'role' })).content).toBe('backend dev')
  })

  test('session scope has the smaller 1,500 char budget', async () => {
    const tool = createMemoryTool(await createTestRepo(), 'user_1', null, 'sess-1')

    const result = await tool.execute('t1', {
      action: 'set',
      key: 'huge',
      value: 'z'.repeat(1600),
      scope: 'session',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('1,500 chars')
  })
})
