import { describe, expect, test } from 'bun:test'
import type { ContextCheckpoint } from '@localixai/agent'

import { persistedRow } from '../history/test-fixtures'
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
const prompt = persistedRow('u3', { role: 'user', content: 'Why did `src/retry-queue.ts` fail?' })
const tools = { recall: true, memory: true }
const keys = (sections: { key: string }[]) => sections.map((section) => section.key)

describe('modelViewSections', () => {
  test('no checkpoint, no pressure: nothing to say', () => {
    expect(modelViewSections({ view: view(), rows, prompt, tools })).toEqual([])
  })

  test('an evicted pin is carried whole in the runtime context', () => {
    const [pinned] = modelViewSections({ view: view(checkpoint()), rows, prompt: undefined, tools })
    expect(pinned?.key).toBe('pinned')
    expect(pinned?.scope).toBe('state')
    expect(pinned?.text).toContain('Keep retries at three')
  })

  // Once a checkpoint has placed the pin in its head it is in the view verbatim; repeating it
  // in the runtime context would send it twice.
  test('a pin the checkpoint keeps in its head is not repeated', () => {
    const record = checkpoint({ pinnedIds: ['u2'] })
    expect(keys(modelViewSections({ view: view(record), rows, prompt: undefined, tools }))).toEqual(
      [],
    )
  })

  test('a term only the evicted turns contain gets a recall pointer to its newest mention', () => {
    const sections = modelViewSections({ view: view(checkpoint()), rows, prompt, tools })
    const hints = sections.find((section) => section.key === 'recall-hints')
    expect(hints?.scope).toBe('turn')
    expect(hints?.text).toContain('history_search(around_message_id="a1")')
  })

  test('without history_search there is no pointer to follow, so no hint', () => {
    const sections = modelViewSections({
      view: view(checkpoint()),
      rows,
      prompt,
      tools: { recall: false, memory: true },
    })
    expect(keys(sections)).not.toContain('recall-hints')
  })

  test('near the checkpoint the agent is told once, naming the memory tool only if it has it', () => {
    const near = view(undefined, { checkpointNear: true })
    const [withMemory] = modelViewSections({ view: near, rows, prompt: undefined, tools })
    expect(withMemory?.key).toBe('checkpoint-near')
    expect(withMemory?.scope).toBe('state')
    expect(withMemory?.text).toContain('memory tool')
    const [without] = modelViewSections({
      view: near,
      rows,
      prompt: undefined,
      tools: { recall: true, memory: false },
    })
    expect(without?.text).not.toContain('memory tool')
  })
})
