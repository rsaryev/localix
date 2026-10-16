import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/agent/agents'
import { createMemoryTool } from './memory'
import {
  MemoryBudgetError,
  type MemoryNote,
  type MemoryRepository,
} from '../../../memory/repository'
import { usageOf } from '../../../memory/file-store'
import type { MemoryScope } from '../../../memory/scope-policy'

// In-memory stub: records every set() and serves a fixed getByKey/list result so
// we can assert the tool's scope routing + read-preference without a database.
function makeRepo(opts: { rows?: MemoryNote[]; throwOnSet?: MemoryBudgetError } = {}) {
  const sets: Array<{ scope: string; key: string; value: string }> = []
  const repo = {
    async getByKey() {
      return opts.rows ?? []
    },
    async list() {
      return opts.rows ?? []
    },
    async set(_u: string, scope: string, key: string, value: string) {
      if (opts.throwOnSet) throw opts.throwOnSet
      sets.push({ scope, key, value })
    },
    async deleteByKey() {
      return true
    },
  }
  return { repo: repo as unknown as MemoryRepository, sets }
}

const run = (
  repo: MemoryRepository,
  input: Record<string, unknown>,
  projectId?: string | null,
  sessionId?: string,
) => createMemoryTool(repo, 'u1', projectId, sessionId).execute('t', input as never)

describe('memory tool — set scope routing', () => {
  test('default in a project writes to the project scope', async () => {
    const { repo, sets } = makeRepo()
    const res = await run(repo, { action: 'set', key: 'k', value: 'v' }, 'proj1', 's1')
    expect(sets[0]).toMatchObject({ scope: 'proj1' })
    expect(res.content).toContain('(project)')
  })

  test('default with NO project stays in the session — never implicit global (bug guard)', async () => {
    const { repo, sets } = makeRepo()
    const res = await run(repo, { action: 'set', key: 'k', value: 'v' }, null, 's1')
    expect(sets[0].scope).toBe('session:s1')
    expect(res.content).toContain('(session)')
  })

  test('scope="global" is the only path to the global scope', async () => {
    const { repo, sets } = makeRepo()
    const res = await run(
      repo,
      { action: 'set', key: 'k', value: 'v', scope: 'global' },
      'proj1',
      's1',
    )
    expect(sets[0].scope).toBe('')
    expect(res.content).toContain('(global)')
  })

  test('explicit session/project scopes route as asked', async () => {
    const a = makeRepo()
    await run(a.repo, { action: 'set', key: 'k', value: 'v', scope: 'session' }, 'proj1', 's1')
    expect(a.sets[0].scope).toBe('session:s1')

    const b = makeRepo()
    await run(b.repo, { action: 'set', key: 'k', value: 'v', scope: 'project' }, 'proj1', 's1')
    expect(b.sets[0].scope).toBe('proj1')
  })

  test('a budget overflow surfaces as an error, nothing saved', async () => {
    const err = new MemoryBudgetError('proj1', usageOf(9000, 8000), ['old'])
    const { repo } = makeRepo({ throwOnSet: err })
    const res = await run(repo, { action: 'set', key: 'k', value: 'v' }, 'proj1', 's1')
    expect(res.isError).toBe(true)
    expect(res.content).toContain('budget exceeded')
  })
})

describe('memory tool — reads + validation', () => {
  test.each(['global', 'project', 'session'] as const)(
    'an agent restricted to %s recalls, saves and deletes only that scope',
    async (selection: MemoryScope) => {
      const seen: unknown[] = []
      const repo = {
        getByKey: async (_u: string, _key: string, scopes: string[]) => {
          seen.push(scopes)
          return []
        },
        list: async (_u: string, scopes: string[]) => {
          seen.push(scopes)
          return []
        },
        deleteByKey: async (_u: string, _key: string, scopes: string[]) => {
          seen.push(scopes)
          return false
        },
        set: async (_u: string, scope: string) => {
          seen.push([scope])
        },
      } as unknown as MemoryRepository
      const tool = createMemoryTool(repo, 'u', 'p', 's', selection)
      for (const action of ['get', 'list', 'set', 'delete'] as const) {
        await tool.execute('call', { action, key: 'k', value: 'v' })
      }
      const target = { global: '', project: 'p', session: 'session:s' }[selection]
      expect(seen).toEqual(Array.from({ length: 4 }, () => [target]))
      expect(tool.classify?.({ action: 'set' })).toEqual({
        effect: selection === 'session' ? 'session' : 'host',
      })
      const other = selection === 'global' ? 'project' : 'global'
      expect(
        (await tool.execute('other', { action: 'set', key: 'k', value: 'v', scope: other }))
          .isError,
      ).toBe(true)
      expect(seen).toHaveLength(4)
    },
  )

  test('get prefers the narrowest scope on a key clash (session > project > global)', async () => {
    const rows: MemoryNote[] = [
      { key: 'k', value: 'from-global', projectId: '' },
      { key: 'k', value: 'from-project', projectId: 'proj1' },
      { key: 'k', value: 'from-session', projectId: 'session:s1' },
    ]
    const { repo } = makeRepo({ rows })
    const res = await run(repo, { action: 'get', key: 'k' }, 'proj1', 's1')
    expect(res.content).toBe('from-session')
  })

  test('get/set/delete require a key; set requires a value', async () => {
    const { repo } = makeRepo()
    expect((await run(repo, { action: 'get' }, 'p', 's')).isError).toBe(true)
    expect((await run(repo, { action: 'delete' }, 'p', 's')).isError).toBe(true)
    expect((await run(repo, { action: 'set', key: 'k' }, 'p', 's')).isError).toBe(true)
  })
})

describe('memory tool — call classification', () => {
  const { repo } = makeRepo()
  type Row = readonly [string, Record<string, unknown>, string | null, CallClass]
  const rows: Row[] = [
    ['get', { action: 'get', key: 'k' }, 'proj1', { effect: 'read' }],
    ['list', { action: 'list' }, 'proj1', { effect: 'read' }],
    ['set, default, in a project', { action: 'set', key: 'k' }, 'proj1', { effect: 'host' }],
    // No project: the note stays in this conversation and is deleted with it.
    ['set, default, no project', { action: 'set', key: 'k' }, null, { effect: 'session' }],
    [
      'set, session scope, in a project',
      { action: 'set', key: 'k', scope: 'session' },
      'proj1',
      { effect: 'session' },
    ],
    ['set, global scope', { action: 'set', key: 'k', scope: 'global' }, null, { effect: 'host' }],
    ['delete', { action: 'delete', key: 'k' }, 'proj1', { effect: 'host', irreversible: true }],
    ['an unknown action', { action: 'bogus' }, 'proj1', { effect: 'external' }],
  ]
  test.each(rows)('%s', (_label, input, projectId, expected) => {
    expect(createMemoryTool(repo, 'u1', projectId, 's1').classify?.(input)).toEqual(expected)
  })
  // Reads overlap the other calls of their turn; every write stays a barrier.
  test.each(rows)('%s schedules by its class', (_label, input, projectId, expected) => {
    expect(createMemoryTool(repo, 'u1', projectId, 's1').executionModeFor?.(input)).toBe(
      expected.effect === 'read' ? 'parallel' : 'sequential',
    )
  })
})
