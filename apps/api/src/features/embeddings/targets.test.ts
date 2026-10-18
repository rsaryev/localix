import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ConsumerHandlers } from '../changes/contracts'
import { createScopedCatalogSource } from './list-source'
import { semanticHandlers } from './targets'

const refs = {
  chat: z.object({ id: z.string() }),
  message: z.object({ id: z.string() }),
  note: z.object({ id: z.string() }),
}
const cascades = { chat: ['message'] } as const

function harness(related: Array<{ collection: string; key: string }> = []) {
  const work: string[] = []
  const handlers = semanticHandlers<typeof refs, typeof cascades>(
    {
      chat: { collection: 'chats', keyOf: (ref) => ref.id, related: async () => related },
      message: { collection: 'messages', keyOf: (ref) => ref.id },
      note: 'ignore',
    },
    {
      changed: async (collection, keys) => void work.push(`changed ${collection} ${keys}`),
      resync: async (collection) => void work.push(`resync ${collection}`),
      removeUnder: async (collection, parent) => void work.push(`remove ${collection} ${parent}`),
    },
  )
  return { handlers: handlers as ConsumerHandlers<typeof refs, typeof cascades>, work }
}

const call = (handler: unknown, change: unknown) =>
  (handler as (change: unknown) => Promise<void>)(change)

describe('semantic targets', () => {
  test('a change re-reads its item and what it touched; a kind-wide notice reconciles', async () => {
    const { handlers, work } = harness([{ collection: 'messages', key: 'm9' }])
    await call(handlers.chat, { entity: 'chat', op: 'upserted', ref: { id: 'c1' } })
    await call(handlers.chat, { entity: 'chat', op: 'deleted', ref: { id: 'c1' } })
    await call(handlers.message, { entity: 'message', op: 'resync' })
    expect(work).toEqual([
      'changed chats c1',
      'changed messages m9',
      'changed chats c1',
      'resync messages',
    ])
    expect(handlers.note).toBe('ignore')
  })

  test('a parent deletion removes the children stored under the parent key', async () => {
    const { handlers, work } = harness()
    await call(handlers.message, {
      entity: 'message',
      op: 'parent-deleted',
      parent: { entity: 'chat', op: 'deleted', ref: { id: 'c1' } },
    })
    expect(work).toEqual(['remove messages c1'])
  })
})

describe('scoped catalog source', () => {
  test('global items once, each project only with its own; a failing scope costs only itself', async () => {
    const global = [{ name: 'review', title: 'review', description: 'Review a diff' }]
    const source = createScopedCatalogSource({
      collection: 'skills',
      label: 'Skills',
      version: 1,
      owner: 'u1',
      projects: async () => ['p1', 'p2'],
      list: async (projectId) => {
        if (projectId === 'p2') throw new Error('unreadable project')
        return projectId === 'p1'
          ? [...global, { name: 'deploy', title: 'deploy', description: '' }]
          : global
      },
    })
    const page = await source.scan(null, 10)
    expect(page.items.map((i) => [i.key, i.scope, i.text])).toEqual([
      ['global:review', 'global', 'Review a diff'],
      ['p1:deploy', 'p1', 'deploy'],
    ])
    expect(page.next).toBeNull()
    expect((await source.read(['p1:deploy'])).map((i) => i.key)).toEqual(['p1:deploy'])
  })
})
