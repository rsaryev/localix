/**
 * The environment service. The invariant under test is "exactly one active" — everything a request
 * renders against depends on it being true.
 */

import { describe, expect, test } from 'bun:test'
import { createEnvironmentService } from './service'
import type { Pair } from '../../request-spec'
import type { SavedEnvironment } from '../store'
import type { EnvironmentStore } from './service'

function stubStore(initial: SavedEnvironment[] = []) {
  const rows = [...initial]
  const store: EnvironmentStore = {
    list: async () => rows.map((r) => ({ ...r })),
    get: async (_u, id) => rows.find((r) => r.id === id) ?? null,
    create: async (_u, entity) => {
      const at = rows.findIndex((r) => r.id === entity.id)
      if (at === -1) rows.push(entity)
      else rows[at] = entity
    },
    updateById: async (_u, id, patch) => {
      const at = rows.findIndex((r) => r.id === id)
      if (at === -1) return null
      rows[at] = { ...rows[at], ...patch, id }
      return rows[at]
    },
    remove: async (_u, id) => {
      const at = rows.findIndex((r) => r.id === id)
      if (at !== -1) rows.splice(at, 1)
    },
  }
  return { store, rows, service: createEnvironmentService(store) }
}

const env = (
  id: string,
  active = false,
  variables: Pair[] = [{ name: 'base_url', value: `https://${id}.dev` }],
): SavedEnvironment => ({
  id,
  createdAt: 0,
  updatedAt: 0,
  active,
  variables,
})

describe('save', () => {
  test('the FIRST environment is active — otherwise it defines nothing', async () => {
    const { service } = stubStore()
    const saved = await service.save('u', 'dev', [{ name: 'base_url', value: 'https://dev.dev' }])
    expect(saved.active).toBe(true)
  })

  test('a SECOND environment is not automatically active', async () => {
    const { service } = stubStore([env('dev', true)])
    expect((await service.save('u', 'prod', [])).active).toBe(false)
  })

  test('re-saving keeps the active flag and the created time', async () => {
    const { service } = stubStore([{ ...env('dev', true), createdAt: 111 }])
    const saved = await service.save('u', 'dev', [{ name: 'x', value: '1' }])
    expect(saved.active).toBe(true)
    expect(saved.createdAt).toBe(111)
    expect(saved.variables).toEqual([{ name: 'x', value: '1' }])
  })

  test('variables are REPLACED, not merged — the list is the environment', async () => {
    const { service } = stubStore([env('dev', true, [{ name: 'old', value: '1' }])])
    const saved = await service.save('u', 'dev', [{ name: 'new', value: '2' }])
    expect(saved.variables).toEqual([{ name: 'new', value: '2' }])
  })
})

describe('use — exactly one active', () => {
  test('activating one deactivates the other', async () => {
    const { service, rows } = stubStore([env('dev', true), env('prod')])
    await service.use('u', 'prod')
    expect(rows.map((r) => [r.id, r.active])).toEqual([
      ['dev', false],
      ['prod', true],
    ])
  })

  test('activating the already-active one is a no-op, not a toggle', async () => {
    const { service, rows } = stubStore([env('dev', true)])
    await service.use('u', 'dev')
    expect(rows[0].active).toBe(true)
  })

  test('an unknown name returns null and changes nothing', async () => {
    const { service, rows } = stubStore([env('dev', true)])
    expect(await service.use('u', 'nope')).toBeNull()
    expect(rows[0].active).toBe(true)
  })
})

describe('activeVars', () => {
  test('the active environment’s variables, as a lookup', async () => {
    const { service } = stubStore([env('dev'), env('prod', true)])
    expect(await service.activeVars('u')).toEqual(new Map([['base_url', 'https://prod.dev']]))
  })

  test('a DISABLED variable is not applied', async () => {
    const { service } = stubStore([
      env('dev', true, [
        { name: 'a', value: '1' },
        { name: 'b', value: '2', disabled: true },
      ]),
    ])
    expect(await service.activeVars('u')).toEqual(new Map([['a', '1']]))
  })

  test('no active environment is an empty map, not a throw', async () => {
    const { service } = stubStore([env('dev')])
    expect(await service.activeVars('u')).toEqual(new Map())
    expect(await service.activeName('u')).toBeNull()
  })

  test('none saved at all is an empty map', async () => {
    const { service } = stubStore()
    expect(await service.activeVars('u')).toEqual(new Map())
  })

  test('two actives (a crash mid-`use`) resolves to the first rather than throwing', async () => {
    // The repair is the next `use`; what must not happen is a hard failure on every send.
    const { service } = stubStore([env('dev', true), env('prod', true)])
    expect(await service.activeName('u')).toBe('dev')
  })
})

describe('delete', () => {
  test('removes it', async () => {
    const { service, rows } = stubStore([env('dev', true)])
    expect(await service.remove('u', 'dev')).toBe(true)
    expect(rows).toEqual([])
  })

  test('deleting the ACTIVE one promotes nothing — a guess is what environments prevent', async () => {
    const { service } = stubStore([env('dev', true), env('prod')])
    await service.remove('u', 'dev')
    expect(await service.activeName('u')).toBeNull()
  })

  test('an unknown name is false', async () => {
    const { service } = stubStore()
    expect(await service.remove('u', 'nope')).toBe(false)
  })
})
