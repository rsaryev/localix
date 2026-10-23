import { describe, expect, test } from 'bun:test'
import type { ContextCheckpoint } from '@localixai/agent'

import { persistedRow } from '../history/testing/test-fixtures'
import { modelViewSections } from './sections'
import type { ModelView } from './view'

const checkpoint = (over: Partial<ContextCheckpoint> = {}): ContextCheckpoint => ({
  version: 1,
  reason: 'threshold',
  coversThroughId: 'a3',
  evictedThroughId: 'a2',
  cards: [],
  transforms: {},
  pinnedIds: [],
  recoveryToolAvailable: true,
  recallToolAvailable: true,
  tokens: { before: 0, after: 0, target: 0 },
  ...over,
})

const view = (record?: ContextCheckpoint, over: Partial<ModelView> = {}): ModelView => ({
  viewer: 'agent:default',
  turnContexts: new Map(),
  epochId: 'host',
  ...(record ? { checkpoint: { hostId: 'host', record } } : {}),
  ...over,
})

const rows = [
  persistedRow('u1', { role: 'user', content: 'Build the importer' }),
  persistedRow('a1', { role: 'assistant', content: 'Edited `src/retry-queue.ts` and more' }),
  persistedRow('u2', { role: 'user', content: 'Keep retries at three', pinned: true }),
  persistedRow('a2', { role: 'assistant', content: 'Done' }),
  persistedRow('a3', { role: 'assistant', content: 'Later work in view' }),
]
const keys = (sections: { key: string }[]) => sections.map((section) => section.key)

describe('modelViewSections', () => {
  test('no checkpoint, no pressure: nothing to say', () => {
    expect(modelViewSections({ view: view(), rows })).toEqual([])
  })

  test('an evicted pin is carried whole in the runtime context', () => {
    const [pinned] = modelViewSections({ view: view(checkpoint()), rows })
    expect(pinned?.key).toBe('pinned')
    expect(pinned?.scope).toBe('state')
    expect(pinned?.text).toContain('Keep retries at three')
  })

  // Once a checkpoint has placed the pin in its head it is in the view verbatim; repeating it
  // in the runtime context would send it twice.
  test('a colleague’s pinned reply is theirs, not the reader’s', () => {
    const colleague = persistedRow('a2', {
      role: 'assistant',
      from: 'agent:qa',
      authorSnapshot: { handle: 'qa' },
      content: 'Checkout verified',
      pinned: true,
    })
    const own = persistedRow('a1', {
      role: 'assistant',
      from: 'agent:default',
      content: 'Mine',
      pinned: true,
    })
    const [pinned] = modelViewSections({
      view: view(checkpoint()),
      rows: [rows[0]!, own, rows[2]!, colleague, rows[4]!],
    })
    expect(pinned?.text).toContain("a2 (qa's reply): Checkout verified")
    expect(pinned?.text).toContain('a1 (your reply): Mine')
  })

  test('a pin the checkpoint keeps in its head is not repeated', () => {
    const record = checkpoint({ pinnedIds: ['u2'] })
    expect(keys(modelViewSections({ view: view(record), rows }))).toEqual([])
  })

  test('near the checkpoint the agent is told once, as a fact without advice', () => {
    const [near] = modelViewSections({ view: view(undefined, { checkpointNear: true }), rows })
    expect(near?.key).toBe('checkpoint-near')
    expect(near?.scope).toBe('state')
    expect(near?.text).toContain('short cards')
    expect(near?.text).not.toContain('memory tool')
  })
})
