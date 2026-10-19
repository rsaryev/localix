import { describe, expect, test } from 'bun:test'
import type { SemanticTask } from '@localixai/plugin-sdk/backend'
import { createSemanticVectors } from './semantic-vectors'

const TOPICS = ['photos', 'contract', 'tiles']
const vectorOf = (text: string) =>
  Float32Array.from(TOPICS.map((t) => (text.includes(t) ? 1 : 0.01)))

function vectors(mode: 'hybrid' | 'lexical' = 'hybrid') {
  const lanes = { query: 0, document: 0 }
  const engine = {
    fingerprint: 'gemma@abc/d3/p1',
    model: { indexDimensions: TOPICS.length },
    embedQuery: async (text: string, _task?: SemanticTask) => {
      lanes.query += 1
      return vectorOf(text)
    },
    embedDocuments: async (docs: readonly { text: string }[]) => {
      lanes.document += docs.length
      return docs.map((doc) => vectorOf(doc.text))
    },
  }
  const port = createSemanticVectors({
    strategy: () => ({ mode }),
    engine: () => engine as never,
  })
  return { port, lanes }
}

const candidates = [
  { key: 'design', text: 'tiles and layout' },
  { key: 'lawyer', text: 'contract and photos' },
]

describe('vectors on demand', () => {
  test('nothing while search answers from words alone', async () => {
    const { port } = vectors('lexical')
    expect(port.ready()).toBeNull()
    expect(await port.embed(['x'], { role: 'query' })).toBeNull()
    expect(await port.rank('x', candidates)).toBeNull()
  })

  test('ranks candidates nearest first, in the model’s vector space', async () => {
    const { port } = vectors()
    expect(port.ready()).toEqual({ model: 'gemma@abc/d3/p1', dimensions: 3 })
    const ranking = await port.rank('may we reuse the photos', candidates, {
      task: 'classification',
    })
    expect(ranking?.model).toBe('gemma@abc/d3/p1')
    expect(ranking?.ranked.map((entry) => entry.key)).toEqual(['lawyer', 'design'])
  })

  test('symmetric tasks stay on the query path; retrieval embeds candidates as documents', async () => {
    const symmetric = vectors()
    await symmetric.port.rank('photos', candidates, { task: 'similarity' })
    expect(symmetric.lanes).toEqual({ query: 3, document: 0 })

    const retrieval = vectors()
    await retrieval.port.rank('photos', candidates, { task: 'search' })
    expect(retrieval.lanes).toEqual({ query: 1, document: 2 })
  })
})
