/**
 * A deterministic embedding engine for tests. Test-only.
 *
 * "Meaning" is a concept table: words of one concept (in any language) light up the same
 * dimension, and any other word lands on a hashed noise dimension. So `\u0440\u0435\u0442\u0440\u0430\u0438 \u0432\u0435\u0431\u0445\u0443\u043a\u043e\u0432` and
 * `webhook retry` are near each other, and unrelated text is not — the shape a real model has,
 * with none of its cost or nondeterminism.
 */
import type { EmbeddingEngine } from '../engine'
import type { EmbeddingModelSpec } from '../models'
import { modelFingerprint } from '../models'
import { truncateNormalize } from '../vectors'

const CONCEPTS: string[][] = [
  ['retry', 'retries', 'redelivery', 'backoff', 'reintento'],
  ['webhook', 'callback', 'webhooks'],
  ['payment', 'card', 'billing', 'declined', 'pago'],
  ['font', 'typography', 'typeface', 'fuente'],
  ['docker', 'container', 'compose'],
  ['database', 'postgres', 'sql', 'port'],
]

export const FAKE_DIMENSIONS = 32

export const FAKE_MODEL: EmbeddingModelSpec = {
  source: {
    kind: 'local',
    local: {
      id: 'test/fake-embedding:F32',
      repo: 'test/fake-embedding',
      revision: 'r1',
      variant: 'F32',
      kind: 'embedding',
      label: 'Fake embedding',
      license: null,
      architecture: null,
      contextLength: 512,
      vision: false,
      files: [{ name: 'm.gguf', url: 'unused', bytes: 3, sha256: 'unused', role: 'weights' }],
      bytes: 3,
    },
  },
  releasedAt: null,
  id: 'test/fake-embedding:F32',
  label: 'Fake embedding',
  attribution: 'tests',
  dimensions: FAKE_DIMENSIONS,
  indexDimensions: FAKE_DIMENSIONS,
  maxChunkChars: 400,
  promptVersion: 1,
  formatQuery: (_task, text) => `Q:${text}`,
  formatDocument: (_task, title, text) => `D:${title ?? ''}:${text}`,
}

export function fakeVector(text: string): Float32Array {
  const v = new Float32Array(FAKE_DIMENSIONS)
  // A shared baseline, so unrelated texts sit at a positive cosine like a real model's.
  v[FAKE_DIMENSIONS - 1] = 1
  for (const word of text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)) {
    const concept = CONCEPTS.findIndex((c) => c.some((w) => word.startsWith(w)))
    if (concept >= 0) v[concept] += 3
    else
      v[
        CONCEPTS.length +
          Number(BigInt(Bun.hash(word)) % BigInt(FAKE_DIMENSIONS - CONCEPTS.length - 1))
      ] += 0.5
  }
  return truncateNormalize(v, FAKE_DIMENSIONS)
}

const strip = (input: string) => input.replace(/^Q:|^D:[^:]*:/, '')

export function createFakeEngine(
  options: { model?: EmbeddingModelSpec; fail?: () => boolean; calls?: string[][] } = {},
): EmbeddingEngine {
  const model = options.model ?? FAKE_MODEL
  const run = async (inputs: string[]) => {
    options.calls?.push(inputs)
    if (options.fail?.()) throw new Error('fake engine failure')
    return inputs.map((i) => fakeVector(strip(i)))
  }
  return {
    model,
    fingerprint: modelFingerprint(model),
    state: () => ({ state: 'ready', error: null }),
    embedQuery: async (text, task = 'search') => (await run([model.formatQuery(task, text)]))[0]!,
    embedDocuments: (docs) =>
      run(docs.map((d) => model.formatDocument(d.task ?? 'search', d.title, d.text))),
    prewarm() {},
    reset() {},
    async stop() {},
  }
}
