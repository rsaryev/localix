import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { plannedDeliveries, type NoticeRow } from './deliveries'

const registry = {
  refs: {
    chat: z.object({ id: z.string() }),
    message: z.object({ id: z.string(), chatId: z.string() }),
    file: z.object({ path: z.string() }),
  },
  cascades: { chat: ['message', 'file'] } as const,
}
const row = (entity: string, op: string, ref: unknown): NoticeRow => ({
  seq: 1,
  entity,
  op,
  ref_json: ref === null ? null : JSON.stringify(ref),
})

describe('plannedDeliveries', () => {
  test('an upsert delivers the change to its own kind only', () => {
    expect(plannedDeliveries(registry, row('chat', 'upserted', { id: 'c1' }))).toEqual([
      { kind: 'chat', delivery: { entity: 'chat', op: 'upserted', ref: { id: 'c1' } } },
    ])
  })

  test('a deletion also reaches every child kind of the cascade, carrying the parent', () => {
    const parent = { entity: 'chat', op: 'deleted', ref: { id: 'c1' } }
    expect(plannedDeliveries(registry, row('chat', 'deleted', { id: 'c1' }))).toEqual([
      { kind: 'chat', delivery: parent },
      { kind: 'message', delivery: { entity: 'message', op: 'parent-deleted', parent } },
      { kind: 'file', delivery: { entity: 'file', op: 'parent-deleted', parent } },
    ])
  })

  test('a child kind deleted on its own cascades nowhere', () => {
    expect(
      plannedDeliveries(registry, row('message', 'deleted', { id: 'm1', chatId: 'c1' })),
    ).toEqual([
      {
        kind: 'message',
        delivery: { entity: 'message', op: 'deleted', ref: { id: 'm1', chatId: 'c1' } },
      },
    ])
  })

  test('a resync carries no ref and no cascade', () => {
    expect(plannedDeliveries(registry, row('chat', 'resync', null))).toEqual([
      { kind: 'chat', delivery: { entity: 'chat', op: 'resync' } },
    ])
  })

  test('a kind the registry does not know delivers nothing', () => {
    expect(plannedDeliveries(registry, row('ghost', 'upserted', { id: 'g1' }))).toEqual([])
  })

  test('a ref its schema rejects, or a missing ref, delivers nothing', () => {
    expect(plannedDeliveries(registry, row('chat', 'upserted', { wrong: 1 }))).toEqual([])
    expect(plannedDeliveries(registry, row('chat', 'upserted', null))).toEqual([])
  })

  test('the parsed ref is what is delivered: unknown fields are stripped by the schema', () => {
    expect(plannedDeliveries(registry, row('chat', 'upserted', { id: 'c1', extra: true }))).toEqual(
      [{ kind: 'chat', delivery: { entity: 'chat', op: 'upserted', ref: { id: 'c1' } } }],
    )
  })

  test('a ref that is not JSON throws, so the caller can count it malformed', () => {
    expect(() =>
      plannedDeliveries(registry, { seq: 1, entity: 'chat', op: 'upserted', ref_json: '{' }),
    ).toThrow()
  })
})
