import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Listing, StoreProvider } from '@localixai/store'
import { makeListing } from '@localixai/store/testing'

import { cardOf, toIndexRow } from './index-rows'
import { fakeProvider } from './testing/fake-provider'
import { TEST_NOW } from './testing'
import { makeStore } from './testing/store'

/**
 * THE STORE'S BUDGETS (`docs/internals/store-scale.md`, "Budgets"), measured over generated
 * indexes of 5,000 and 20,000 listings: the first page, a search with meaning (the model stubbed),
 * the next page, and re-indexing one 2,300-entry marketplace.
 */

const WORDS = [
  'postgres',
  'review',
  'kubernetes',
  'deploy',
  'lint',
  'test',
  'design',
  'figma',
  'notes',
  'security',
  'scanner',
  'python',
  'typescript',
  'rust',
  'docs',
  'chart',
  'slack',
  'github',
  'terraform',
  'docker',
  'redis',
  'mongodb',
  'graph',
  'api',
  'agent',
  'skill',
  'commit',
  'game',
]
const TRUSTS = ['localix', 'official', 'community'] as const

function generated(count: number, source: string, seed = 0, allPlugins = false): Listing[] {
  return Array.from({ length: count }, (_, n) => {
    const word = (k: number) => WORDS[(n * 7 + k * 13 + seed) % WORDS.length]!
    return makeListing({
      id: `${source}-${n}`,
      kind: n % 5 === 0 && !allPlugins ? 'mini-app' : 'plugin',
      displayName: `${word(0)} ${word(1)} ${n}`,
      summary: `Helps you ${word(2)} and ${word(3)} with ${word(4)} from the agent`,
      tags: [word(5), word(6)],
      source: { id: source, label: source, trust: TRUSTS[n % 3]! },
      components: [
        { kind: 'skill', name: `${word(7)}-skill` },
        { kind: 'command', name: `/${word(8)}` },
      ],
      contents: { skill: 1, command: 1 },
      featured: n % 97 === 0,
      origin: `git:github.com/acme/${word(0)}-${n % 4000}`,
    })
  })
}

const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!
/** Each run's time, after one that warms the statements up. */
async function timed(run: (n: number) => Promise<unknown>, times: number): Promise<number[]> {
  await run(0)
  const samples: number[] = []
  for (let n = 0; n < times; n++) {
    const at = performance.now()
    await run(n)
    samples.push(performance.now() - at)
  }
  return samples
}

for (const size of [5_000, 20_000]) {
  describe(`the Store over ${size.toLocaleString('en')} listings`, () => {
    const actor = { userId: 'u1' }
    let opened: ReturnType<typeof makeStore>
    let providers: StoreProvider[]
    beforeAll(async () => {
      // One marketplace of 2,300 beside the rest, as the community one is today.
      providers = [
        fakeProvider('plugin', [...generated(2_300, 'market'), ...generated(size - 2_300, 'other')])
          .provider,
      ]
      opened = makeStore(providers, {
        // Meaning stubbed: the semantic index answers its 80 best for every query.
        meaning: () =>
          Array.from({ length: 80 }, (_, n) => ({
            key: `plugin:other-${n * 11 + 1}`,
            z: 4 - n / 40,
          })),
      })
      await opened.store.listings(actor, {})
    }, 60_000)
    afterAll(() => opened.close())

    test('opens to its first cards in 150 ms', async () => {
      const samples = await timed(() => opened.store.listings(actor, {}), 10)
      expect(p95(samples)).toBeLessThan(150)
    })

    test('searches by words and meaning in 60 ms at p95', async () => {
      const queries = ['postgres', 'code review', 'kubernetes deploy', 'lint typ', 'figma design']
      const samples = await timed(
        (n) => opened.store.listings(actor, { q: queries[n % queries.length]! }),
        20,
      )
      expect(p95(samples)).toBeLessThan(60)
    })

    test('scrolls to the next page in 20 ms at p95', async () => {
      const first = await opened.store.listings(actor, {})
      const samples = await timed(
        () => opened.index.page('u1', {}, { limit: 40, cursor: first.nextCursor! }),
        20,
      )
      expect(p95(samples)).toBeLessThan(20)
    })

    test('re-indexes a 2,300-entry marketplace in a second, off the request path', async () => {
      const cards = generated(2_300, 'market', 3, true).map(cardOf)
      const at = performance.now()
      await opened.index.replaceSource(
        'plugin',
        'market',
        cards.map((card) => toIndexRow(card, { now: TEST_NOW })),
        { revision: 'next', now: new Date(TEST_NOW).toISOString() },
      )
      await opened.index.markDuplicates()
      expect(performance.now() - at).toBeLessThan(1_000)
    })
  })
}
