import { describe, expect, test } from 'bun:test'

import type { TriggerRecord } from './contracts'
import { createAgentTriggerCleanup } from './agent-cleanup'

const trigger = (id: string, agentId: string | null, state: TriggerRecord['state'] = 'armed') =>
  ({
    id,
    userId: 'u1',
    sessionId: `s-${id}`,
    owner: agentId ? { kind: 'agent', agentId } : { kind: 'user' },
    action: 'loop',
    state,
  }) as TriggerRecord

function setup(live: TriggerRecord[], bound: string[]) {
  const ended: string[] = []
  const told: string[] = []
  const cleanup = createAgentTriggerCleanup({
    live: () => live.filter((t) => !ended.includes(t.id)),
    end: async (id) => void ended.push(id),
    bound: async (id) => bound.includes(id),
    ownerGone: (t) => void told.push(t.id),
  })
  const handler = cleanup.handlers.agent
  if (handler === 'ignore') throw new Error('expected a handler')
  return { handler, ended, told }
}

const gone = { entity: 'agent' as const, op: 'deleted' as const }
const ref = (agentId: string) => ({ id: 'x', scope: 'global', agentId })

describe('triggers owned by an agent that is gone', () => {
  test('a purge stops its live triggers and tells the person; a repeat finds nothing to stop', async () => {
    const t = setup([trigger('a', 'cc:1'), trigger('b', 'cc:1', 'held'), trigger('c', 'cc:2')], [])
    await t.handler({ ...gone, ref: ref('cc:1') })
    await t.handler({ ...gone, ref: ref('cc:1') })
    expect(t.ended).toEqual(['a', 'b'])
    expect(t.told).toEqual(['a', 'b'])
  })

  test('a rename leaves them running: the old key is deleted while the id is still bound', async () => {
    const t = setup([trigger('a', 'cc:1')], ['cc:1'])
    await t.handler({ ...gone, ref: ref('cc:1') })
    expect(t.ended).toEqual([])
  })

  test('a resync stops the orphans only; a user trigger and a built-in owner stay', async () => {
    const t = setup(
      [
        trigger('orphan', 'native:old'),
        trigger('kept', 'cc:1'),
        trigger('mine', null),
        trigger('main', 'builtin:localix'),
      ],
      ['cc:1'],
    )
    await t.handler({ entity: 'agent', op: 'resync' })
    expect(t.ended).toEqual(['orphan'])
  })
})
