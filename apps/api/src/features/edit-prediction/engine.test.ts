/**
 * Provider-matrix CONTRACT tests — drive the engine through fake
 * `EditPredictionModelAdapter`s covering the response/capability matrix: structured
 * vs no-structured output, cancellation-capable vs not, and 429/5xx/timeout/truncated/
 * malformed replies. Each asserts the engine's typed neutral outcome (never a thrown
 * transport error, never a partial edit).
 */

import { describe, expect, it } from 'bun:test'
import { createEditPredictionEngine } from './engine'
import { createEditPredictionCache } from './cache/memory'
import type {
  EditPredictionModelAdapter,
  EditPredictionModelCapabilities,
  NormalizedModelResponse,
} from './model/contracts'

const FILE = ['const a = 1', 'const b = 2', 'const c = 3'].join('\n')
const CORRELATION = { requestId: 'req-1', documentVersion: 1, documentDigest: 'digest-1' }
const CAPS: EditPredictionModelCapabilities = {
  structuredOutput: false,
  streaming: true,
  cancellation: true,
  promptCaching: 'long',
}

function engineWith(
  adapter: EditPredictionModelAdapter,
  opts: { deadlineMs?: number; recordOutcome?: (e: unknown) => void } = {},
) {
  return createEditPredictionEngine({
    createModelAdapter: () => adapter,
    deadlineMs: opts.deadlineMs,
    recordOutcome: opts.recordOutcome as never,
    readAgentSettings: async () =>
      ({
        modelRouting: {
          inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
        },
      }) as never,
    getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
    buildLanguageModel: async () => ({ providerConnectionId: 'p', provider: {} }) as never,
  })
}

const REQ = {
  sessionId: 's',
  ...CORRELATION,
  filepath: '/p/a.ts',
  content: FILE,
  cursorLine: 1,
  language: 'typescript',
  recentlyEditedRanges: [],
}

function responder(
  res: Partial<NormalizedModelResponse>,
  caps: EditPredictionModelCapabilities = CAPS,
): EditPredictionModelAdapter {
  return {
    capabilities: () => caps,
    predict: async () => ({
      text: '',
      usage: undefined,
      finishReason: 'stop',
      truncated: false,
      ...res,
    }),
  }
}

function thrower(
  error: unknown,
  caps: EditPredictionModelCapabilities = CAPS,
): EditPredictionModelAdapter {
  return {
    capabilities: () => caps,
    predict: async () => {
      throw error
    },
  }
}

describe('provider matrix — response shapes', () => {
  it('structured JSON output → predicted', async () => {
    const res = await engineWith(
      responder({
        text: '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}',
      }),
    ).predictDetailed('u', REQ)
    expect(res.outcome).toBe('predicted')
    expect(res.edits).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
  })

  it('structured-output-capable model → still predicted (capability is informational)', async () => {
    const caps = { ...CAPS, structuredOutput: true }
    const res = await engineWith(
      responder(
        { text: '{"edits":[{"startLine":1,"endLine":1,"replacement":"const a = 10"}]}' },
        caps,
      ),
    ).predictDetailed('u', REQ)
    expect(res.outcome).toBe('predicted')
  })

  it('malformed / non-JSON reply → empty (fail-safe, no edit)', async () => {
    const res = await engineWith(
      responder({ text: 'sorry, here is what I think' }),
    ).predictDetailed('u', REQ)
    expect(res).toEqual({ outcome: 'empty', edits: null })
  })

  it('explicit null reply → empty', async () => {
    const res = await engineWith(responder({ text: 'null' })).predictDetailed('u', REQ)
    expect(res).toEqual({ outcome: 'empty', edits: null })
  })

  it('TRUNCATED reply (finishReason length) → provider_error, never parsed', async () => {
    // A truncated reply may contain a complete-looking first edit; strict handling
    // rejects it rather than applying a half-written hunk.
    const res = await engineWith(
      responder({
        text: '{"startLine":2,"endLine":2,"replacement":"const b = 20"}',
        finishReason: 'length',
        truncated: true,
      }),
    ).predictDetailed('u', REQ)
    expect(res).toEqual({ outcome: 'provider_error', edits: null })
  })

  it('records usage even for a truncated reply (spend happened)', async () => {
    const usages: unknown[] = []
    const engine = createEditPredictionEngine({
      createModelAdapter: () => responder({ text: '{', finishReason: 'length', truncated: true }),
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () => ({ providerConnectionId: 'p', provider: {} }) as never,
      recordUsage: (e) => usages.push(e),
    })
    await engine.predictDetailed('u', REQ)
    expect(usages).toHaveLength(1)
  })
})

describe('provider matrix — transport failures', () => {
  for (const [label, error] of [
    ['429', { status: 429 }],
    ['5xx', { status: 503 }],
    ['timeout', { code: 'ETIMEDOUT' }],
    ['generic', new Error('boom')],
  ] as const) {
    it(`${label} throw → provider_error`, async () => {
      const res = await engineWith(thrower(error)).predictDetailed('u', REQ)
      expect(res).toEqual({ outcome: 'provider_error', edits: null })
    })
  }
})

describe('provider matrix — cancellation & deadline', () => {
  it('caller cancellation while the adapter is in flight → cancelled', async () => {
    const adapter: EditPredictionModelAdapter = {
      capabilities: () => CAPS,
      predict: async (_req, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        throw new DOMException('aborted', 'AbortError')
      },
    }
    const controller = new AbortController()
    const pending = engineWith(adapter).predictDetailed('u', REQ, controller.signal)
    await new Promise((r) => setTimeout(r, 0))
    controller.abort()
    expect(await pending).toEqual({ outcome: 'cancelled', edits: null })
  })

  it('host deadline elapses while the adapter hangs → deadline_exceeded', async () => {
    const adapter: EditPredictionModelAdapter = {
      capabilities: () => CAPS,
      predict: async (_req, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        throw new DOMException('aborted', 'AbortError')
      },
    }
    const res = await engineWith(adapter, { deadlineMs: 10 }).predictDetailed('u', REQ)
    expect(res).toEqual({ outcome: 'deadline_exceeded', edits: null })
  })

  it('a cancellation-INCAPABLE adapter that ignores the signal still yields its outcome', async () => {
    // Some providers cannot abort mid-flight; the engine must not hang — it returns
    // whatever the (eventually resolved) response classifies to.
    const caps = { ...CAPS, cancellation: false }
    const res = await engineWith(responder({ text: 'null' }, caps)).predictDetailed('u', REQ)
    expect(res.outcome).toBe('empty')
  })
})

describe('engine — L1 result cache + single-flight', () => {
  const PRED = '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}'
  function countingEngine(text: string, resultCache = createEditPredictionCache()) {
    let calls = 0
    const engine = createEditPredictionEngine({
      resultCache,
      createModelAdapter: () => ({
        capabilities: () => CAPS,
        predict: async () => {
          calls++
          return { text, usage: undefined, finishReason: 'stop', truncated: false }
        },
      }),
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () => ({ providerConnectionId: 'p', provider: {} }) as never,
    })
    return { engine, calls: () => calls, resultCache }
  }

  it('a second identical request is served from cache (no second model call)', async () => {
    const { engine, calls } = countingEngine(PRED)
    const first = await engine.predictDetailed('u', REQ)
    const second = await engine.predictDetailed('u', REQ)
    expect(first.outcome).toBe('predicted')
    expect(second).toEqual(first)
    expect(calls()).toBe(1)
  })

  it('does NOT cache a provider error (recomputes next time)', async () => {
    let calls = 0
    const engine = createEditPredictionEngine({
      resultCache: createEditPredictionCache(),
      createModelAdapter: () => ({
        capabilities: () => CAPS,
        predict: async () => {
          calls++
          throw new Error('boom')
        },
      }),
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () => ({ providerConnectionId: 'p', provider: {} }) as never,
    })
    expect((await engine.predictDetailed('u', REQ)).outcome).toBe('provider_error')
    expect((await engine.predictDetailed('u', REQ)).outcome).toBe('provider_error')
    expect(calls).toBe(2)
  })

  it('a differing cursor is a cache miss', async () => {
    const { engine, calls } = countingEngine(PRED)
    await engine.predictDetailed('u', REQ)
    await engine.predictDetailed('u', { ...REQ, cursorLine: 2 })
    expect(calls()).toBe(2)
  })

  it('deadline through the cache still surfaces deadline_exceeded', async () => {
    const engine = createEditPredictionEngine({
      resultCache: createEditPredictionCache(),
      deadlineMs: 10,
      createModelAdapter: () => ({
        capabilities: () => CAPS,
        predict: async (_req, signal) => {
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          )
          throw new DOMException('aborted', 'AbortError')
        },
      }),
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () => ({ providerConnectionId: 'p', provider: {} }) as never,
    })
    expect(await engine.predictDetailed('u', REQ)).toEqual({
      outcome: 'deadline_exceeded',
      edits: null,
    })
  })
})

describe('engine — model resolution', () => {
  it('no usable provider → no_model', async () => {
    const engine = createEditPredictionEngine({
      readAgentSettings: async () => null,
      getSessionModel: async () => null,
      buildLanguageModel: async () => null,
    })
    expect(await engine.predictDetailed('u', REQ)).toEqual({ outcome: 'no_model', edits: null })
  })

  it('empty document → empty (no model call)', async () => {
    let called = false
    const engine = engineWith({
      capabilities: () => CAPS,
      predict: async () => {
        called = true
        return { text: '', usage: undefined, finishReason: 'stop', truncated: false }
      },
    })
    expect(await engine.predictDetailed('u', { ...REQ, content: '   ' })).toEqual({
      outcome: 'empty',
      edits: null,
    })
    expect(called).toBe(false)
  })
})
