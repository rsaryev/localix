import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { EMBEDDINGGEMMA_2 } from '../embeddings/models'
import { routerEmbeddingBackend } from '../embeddings/router-backend'
import { createSemanticService, type SemanticServiceDeps } from '../embeddings/service'
import { createSemanticStore } from '../embeddings/store'
import { startLlamaServer, type LlamaServer } from '../local-models/llama-server'
import { wordsOf } from './project-signals'
import { STORE_COLLECTION } from './search-provider'
import { createStoreSemanticSource } from './semantic'
import { fakeProvider } from './testing/fake-provider'
import { judged } from './testing/recommend-eval'
import { CATALOG } from './testing/recommend-golden'
import { CASES, type GoldenCase } from './testing/recommend-golden-cases'
import { makeStore } from './testing/store'

/**
 * HOW GOOD RECOMMENDATIONS ARE, with the real model (`docs/internals/store.md`, "Measuring
 * recommendations"): the golden set (`testing/recommend-golden*.ts`) through the Store and the
 * semantic index as `bootstrap/` builds them, its cards embedded by EmbeddingGemma 2 in a
 * llama-server of its own. The thresholds are regression gates, set a little under what the
 * ranking scored when they were written; a change that lowers them says what it costs. It needs
 * the model and the runtime Localix downloads (`~/.localix/models`, or `LOCALIX_EVAL_MODELS`) and
 * is skipped without them.
 */

// The test preload gives every run a scratch home; the model is in the person's own.
const MODELS = process.env.LOCALIX_EVAL_MODELS ?? join(userInfo().homedir, '.localix', 'models')
const MODEL = join(
  MODELS,
  'models',
  'ggml-org--embeddinggemma-2-GGUF--Q8_0',
  'embeddinggemma-2-Q8_0.gguf',
)
const RUNTIME = (
  existsSync(MODELS) ? [...new Bun.Glob('runtime/*/llama-server').scanSync({ cwd: MODELS })] : []
)
  .map((path) => join(MODELS, path))
  .sort()
  .at(-1)
const READY = existsSync(MODEL) && !!RUNTIME

/**
 * Mean nDCG@10 and recall@10 over the cases, and no bad pick in any. Scored 0.58 and 0.38 when
 * written: recall is low on purpose, since only what stands out by meaning or a package's own
 * word counts as matched and the rest of the row is filled with trusted packages.
 */
const GATES = { ndcg: 0.52, recall: 0.33 }

const actor = { userId: 'u1' }

/** Local models as the semantic service asks them: the model is here; nothing else is used. */
const localModels = {
  isInstalled: () => true,
  background: { reconcile: () => {} } as never,
  job: () => null,
  router: {} as never,
  status: async () => ({
    runtime: { supported: true, tag: 'eval', installed: true },
    machine: null,
    installed: [],
    jobs: [],
    paused: [],
    running: [],
    diskBytes: 0,
  }),
  subscribe: () => () => {},
} satisfies SemanticServiceDeps['localModels']

let server: LlamaServer | null = null
beforeAll(async () => {
  if (!READY) return
  server = await startLlamaServer({
    executable: RUNTIME!,
    cwd: join(RUNTIME!, '..'),
    args: (port, apiKey) => [
      '-m',
      MODEL,
      '--embeddings',
      '-c',
      '4096',
      '-b',
      '1024',
      '-ub',
      '1024',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--api-key',
      apiKey,
    ],
  })
})
afterAll(async () => {
  await server?.stop()
})

/** One case, through a Store and a semantic index of its own: the ids it recommends, in order. */
async function recommended(golden: GoldenCase): Promise<string[]> {
  const db = createDatabase()
  await migrateToLatest(db)
  const semantic = createSemanticService({
    store: createSemanticStore(db),
    localModels,
    model: EMBEDDINGGEMMA_2,
    backend: (model) => routerEmbeddingBackend({ ensure: async () => server! }, model.id),
  })
  const installed = new Set(golden.installed ?? [])
  const listings = CATALOG.map((listing) =>
    installed.has(listing.ref.id)
      ? { ...listing, installs: [{ scope: 'user' as const, version: '1.0.0', enabled: true }] }
      : listing,
  )
  const opened = makeStore([fakeProvider('plugin', listings).provider], {
    semantic: {
      strategy: {
        note: () => semantic.strategy(),
        queryFor: (userId, text) => semantic.reader.queryFor(userId, text),
      },
      similarToItems: (userId, members, options) =>
        semantic.reader.similarToItems(userId, STORE_COLLECTION, members, options),
    },
    context: async () => golden.pieces ?? [],
    ...(golden.project
      ? { projectFacts: golden.project, projectWords: [...wordsOf(golden.project)] }
      : {}),
  })
  try {
    const request = { references: [], ...(golden.project ? { projectId: 'p1' } : {}) }
    // The first answer syncs the Store's index; its cards are then embedded.
    await opened.store.recommend(actor, request)
    semantic.registerSource(createStoreSemanticSource({ index: opened.index, owner: actor.userId }))
    await semantic.boot()
    for (let pass = 0; pass < 20; pass++) {
      await semantic.settle()
      if ((await semantic.status()).index.items >= CATALOG.length) break
    }
    const answer = await opened.store.recommend(actor, request)
    return answer.listings.slice(0, answer.matched).map((listing) => listing.ref.id)
  } finally {
    await semantic.shutdown()
    await opened.close()
    await db.destroy()
  }
}

describe.skipIf(!READY)('recommendations against the golden set, with EmbeddingGemma 2', () => {
  test(
    'rank what suits each case first, and nothing that does not',
    async () => {
      const scored: Array<{ name: string; ids: string[] } & ReturnType<typeof judged>> = []
      for (const golden of CASES) {
        const ids = await recommended(golden)
        scored.push({ name: golden.name, ids, ...judged(ids, golden) })
      }
      // The report a change to the ranking is read by.
      console.table(
        scored.map(({ name, ids, ndcg, recall, bad }) => ({
          case: name,
          ndcg: ndcg.toFixed(2),
          recall: recall.toFixed(2),
          bad: bad.join(', '),
          top: ids.slice(0, 5).join(', '),
        })),
      )
      const mean = (of: (score: (typeof scored)[number]) => number) =>
        scored.reduce((sum, score) => sum + of(score), 0) / scored.length

      expect(scored.flatMap((score) => score.bad)).toEqual([])
      expect(mean((score) => score.ndcg)).toBeGreaterThanOrEqual(GATES.ndcg)
      expect(mean((score) => score.recall)).toBeGreaterThanOrEqual(GATES.recall)
    },
    { timeout: 300_000 },
  )
})
