import { describe, expect, test } from 'bun:test'
import type { SemanticStatus } from '@/shared/api/semanticApi'
import { indexActivity, indexLine } from './semanticFormat'

const status = (index: Partial<SemanticStatus['index']>): SemanticStatus =>
  ({
    model: { id: 'm', label: 'EmbeddingGemma 2', attribution: '', bytes: 1, installed: true },
    index: {
      phase: 'idle',
      items: 134,
      chunks: 140,
      pendingChanges: 0,
      chunksPerSecond: null,
      lastError: null,
      collections: [],
      ...index,
    },
  }) as unknown as SemanticStatus

describe('indexLine', () => {
  test('a build shows its share, its rate and the time left', () => {
    const line = indexLine(
      status({
        phase: 'reconciling',
        chunksPerSecond: 40,
        collections: [
          {
            name: 'chat.messages',
            label: 'Messages',
            items: 0,
            chunks: 0,
            scanned: 40,
            total: 160,
            reconciling: true,
          },
        ],
      }),
    )
    expect(line).toEqual({ text: 'Building the index · 25% · 40 chunks/s · 3 s left', percent: 25 })
  })

  test('at rest it counts what is indexed', () => {
    expect(indexLine(status({})).text).toBe('134 items indexed')
  })

  test('a stalled index says why', () => {
    expect(indexLine(status({ phase: 'retrying', lastError: 'model server stopped' })).text).toBe(
      'Indexing will retry: model server stopped',
    )
  })
})

describe('indexActivity', () => {
  const live = (index: Partial<SemanticStatus['index']>, extra: Partial<SemanticStatus> = {}) =>
    ({
      ...status(index),
      supported: true,
      install: { state: 'idle', received: 0, total: 0, error: null },
      engine: { state: 'ready', error: null },
      ...extra,
    }) as SemanticStatus

  test('at rest it reads indexed; waiting for its model it says so; unsupported it says nothing', () => {
    expect(indexActivity(live({}))?.activity).toBe('idle')
    // Always on: a model not here yet is on its way, and search answers from words meanwhile.
    const waiting = { ...live({}), model: { ...live({}).model, installed: false } }
    expect(indexActivity(waiting)).toMatchObject({ activity: 'downloading', label: 'Search model' })
    expect(indexActivity({ ...live({}), supported: false })).toBeNull()
  })

  test('a build, a pause and a failure each have their own state', () => {
    const building = {
      phase: 'reconciling' as const,
      collections: [
        {
          name: 'm',
          label: 'Messages',
          items: 0,
          chunks: 0,
          scanned: 1,
          total: 4,
          reconciling: true,
        },
      ],
    }
    expect(indexActivity(live(building))).toEqual({
      activity: 'building',
      label: 'Indexing',
      percent: 25,
    })
    expect(indexActivity(live({ ...building, phase: 'paused' }))?.activity).toBe('paused')
    expect(indexActivity(live({ phase: 'retrying' }))?.activity).toBe('failed')
  })

  test('a few changes do not flicker the bar; a backlog does', () => {
    expect(indexActivity(live({ phase: 'updating', pendingChanges: 3 }))?.activity).toBe('idle')
    expect(indexActivity(live({ phase: 'updating', pendingChanges: 400 }))?.activity).toBe(
      'updating',
    )
  })

  test('the model download comes first', () => {
    const downloading = live(
      {},
      { install: { state: 'downloading', received: 1, total: 4, error: null } },
    )
    expect(indexActivity(downloading)).toEqual({
      activity: 'downloading',
      label: 'Search model',
      percent: 25,
    })
  })
})
