import { describe, expect, test } from 'bun:test'
import type { RecommendRequest } from '@localixai/store'
import { makeListing } from '@localixai/store/testing'

import { createRecommendationBoard } from './recommend-board'

const actor = { userId: 'u1' }
const docker = makeListing({ id: 'docker', kind: 'plugin' })
const fonts = makeListing({ id: 'fonts', kind: 'plugin' })

/**
 * A board over a fake answer and a manual clock: `later` holds what the board scheduled, and
 * `flush` runs it, so a test decides when the background work happens without sleeping.
 */
function board(answer: (request: RecommendRequest) => string[]) {
  const asked: RecommendRequest[] = []
  const later: Array<() => void> = []
  let pokes = 0
  const listings = { docker, fonts } as const
  const made = createRecommendationBoard({
    compute: async (_actor, request) => {
      asked.push(request)
      return {
        listings: answer(request).map((id) => listings[id as keyof typeof listings]),
        matched: answer(request).length,
        strategy: { mode: 'hybrid' },
      }
    },
    schedule: (run) => {
      later.push(run)
      return () => {}
    },
  })
  made.subscribe(() => pokes++)
  const flush = async () => {
    for (const run of later.splice(0)) run()
    await made.settled()
  }
  return { board: made, asked, flush, pokes: () => pokes }
}

const compose = { kind: 'file', token: '@file:compose.yaml', label: 'compose.yaml' }

describe('recommendations worked out in the background', () => {
  test('a reported working set is answered later, and readers are poked once it is', async () => {
    const { board: recommendations, flush, pokes } = board(() => ['docker'])

    recommendations.report(actor, { projectId: 'p1', references: [compose] })
    expect(await recommendations.read(actor, { projectId: 'p1' })).toMatchObject({
      listings: [],
      pending: true,
    })

    await flush()
    const ready = await recommendations.read(actor, { projectId: 'p1' })
    expect(ready.listings.map((listing) => listing.ref.id)).toEqual(['docker'])
    expect(ready.pending).toBe(false)
    expect(pokes()).toBe(1)
  })

  test('a read nobody reported for is worked out lazily, from the project alone', async () => {
    const { board: recommendations, flush, asked } = board(() => ['docker'])

    expect((await recommendations.read(actor, { projectId: 'p1' })).pending).toBe(true)
    await flush()

    expect(asked).toEqual([{ projectId: 'p1', references: [] }])
  })

  test('the same working set reported again is not worked out again', async () => {
    const { board: recommendations, flush, asked } = board(() => ['docker'])

    recommendations.report(actor, { projectId: 'p1', references: [compose] })
    await flush()
    recommendations.report(actor, { projectId: 'p1', references: [compose] })
    await flush()

    expect(asked).toHaveLength(1)
  })

  test('the Store changing works every remembered set out again, poking only when the answer moved', async () => {
    let installed = false
    const {
      board: recommendations,
      flush,
      pokes,
    } = board(() => (installed ? ['fonts'] : ['docker', 'fonts']))
    recommendations.report(actor, { projectId: 'p1', references: [compose] })
    await flush()

    recommendations.refresh()
    await flush()
    expect(pokes()).toBe(1)

    installed = true
    recommendations.refresh()
    await flush()
    expect(pokes()).toBe(2)
    expect(
      (await recommendations.read(actor, { projectId: 'p1' })).listings.map((l) => l.ref.id),
    ).toEqual(['fonts'])
  })

  test('a failed answer keeps the last one and pokes nobody', async () => {
    let fails = false
    const {
      board: recommendations,
      flush,
      pokes,
    } = board(() => {
      if (fails) throw new Error('index unreachable')
      return ['docker']
    })
    recommendations.report(actor, { projectId: 'p1', references: [compose] })
    await flush()

    fails = true
    recommendations.refresh()
    await flush()

    expect(pokes()).toBe(1)
    expect(
      (await recommendations.read(actor, { projectId: 'p1' })).listings.map((l) => l.ref.id),
    ).toEqual(['docker'])
  })
})
