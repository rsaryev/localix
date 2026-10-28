import { sessionFixture } from '../../../../testing/session-fixture'
import { testWork } from '../../../../testing/work-fixture'
import { describe, expect, test } from 'bun:test'

import {
  MAX_TRANSIENT_RETRIES,
  attemptOverflowRecovery,
  attemptSilentEmptyRecovery,
  attemptTransientRetry,
  isOversizedRequest,
  isSilentlyEmptyRun,
  shouldTransientRetry,
} from './recovery'
import { prepareRetryContinuation, restoreCompletedTurnCheckpoint } from './retry-checkpoint'
import { ensureSessionStores } from './session-stores'
import { dispatchParams } from '../run-params'
import { createRuntimeState } from '../agent-runner-state'
import { LocalContextBudgetExceededError, resolveContextBudgetFrame } from '../context-budget'
import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import type { RunEnv, RunParams } from './types'
import { DEFAULT_AGENT_AUTHOR, USER_AUTHOR } from '../../../../db'

const base = {
  turns: 0,
  hasContent: false,
  isEmptyAcc: true,
  stopReason: undefined as string | undefined,
  aborted: false,
}

describe('isSilentlyEmptyRun', () => {
  test('flags a zero-turn run that produced nothing and did not abort', () => {
    expect(isSilentlyEmptyRun(base)).toBe(true)
  })

  test('is quiet once a turn completed (normal run)', () => {
    expect(isSilentlyEmptyRun({ ...base, turns: 1 })).toBe(false)
  })

  test('is quiet when the model wrote text', () => {
    expect(isSilentlyEmptyRun({ ...base, hasContent: true })).toBe(false)
  })

  test('is quiet when tool items were produced (acc not empty)', () => {
    expect(isSilentlyEmptyRun({ ...base, isEmptyAcc: false })).toBe(false)
  })

  test('is quiet when a stop notice explains the empty run', () => {
    expect(isSilentlyEmptyRun({ ...base, stopReason: 'no_progress' })).toBe(false)
  })

  test('is quiet when the run was aborted (user cancel / deadline)', () => {
    expect(isSilentlyEmptyRun({ ...base, aborted: true })).toBe(false)
  })
})

const localRefusal = (reason: LocalContextBudgetExceededError['reason']) =>
  new LocalContextBudgetExceededError({
    reason,
    frame: resolveContextBudgetFrame({ contextWindow: 32_000 }),
    requiredTokens: 40_000,
    availableTokens: 30_000,
    estimateSource: 'heuristic',
    message: 'too large',
  })

describe('isOversizedRequest', () => {
  test('a provider overflow is oversized', () => {
    expect(isOversizedRequest('context_overflow', new Error('prompt is too long'))).toBe(true)
  })

  test('a local refusal counts only when evicting older turns could change it', () => {
    expect(isOversizedRequest('fatal', localRefusal('estimated_context_too_large'))).toBe(true)
    // The active turn alone does not fit: a checkpoint evicts older turns, never this one.
    expect(isOversizedRequest('fatal', localRefusal('active_turn_too_large'))).toBe(false)
    expect(isOversizedRequest('fatal', localRefusal('protected_history_too_large'))).toBe(false)
  })

  test('any other failure is not', () => {
    expect(isOversizedRequest('fatal', new Error('boom'))).toBe(false)
  })
})

/**
 * A run whose request did not fit, ready to be recovered: the relaunch is recorded instead of
 * run, and the runtime state is real so the lane's checkpoint request can be read back.
 */
function checkpointHarness(chain: Partial<RunParams['chain']> = {}) {
  const session = { ...sessionFixture(), id: 'recover-session' } as SessionRecord
  const timestamp = '2026-09-24T00:00:00.000Z'
  const row = (id: string, role: 'user' | 'assistant'): PersistedMessage => ({
    id,
    userId: 'u',
    sessionId: session.id,
    payload: {
      id,
      role,
      from: role === 'user' ? USER_AUTHOR : DEFAULT_AGENT_AUTHOR,
      content: role === 'user' ? 'go' : '',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const rows = [row('u', 'user'), row('a', 'assistant')]
  const launched: RunParams[] = []
  const abort = new AbortController()
  const env = {
    now: () => timestamp,
    state: {
      activeRuns: new Map([[session.id, abort]]),
      activeRunSessions: new Map([[session.id, { userId: 'u', session }]]),
    },
    deps: { streamRegistry: { publish: () => undefined } },
    repo: {
      listMessages: async () => [...rows],
      insertMessage: async () => undefined,
    },
    persistAndPublish: async () => undefined,
    run: async (params: RunParams) => {
      launched.push(params)
    },
  }
  const dispatched = dispatchParams(
    { userId: 'u', session, assistantMessageId: 'a', historyMessages: rows },
    {} as RunParams['scope'],
  )
  const params = { ...dispatched, chain: { ...dispatched.chain, ...chain } }
  const runtimeState = createRuntimeState(testWork())
  const args = {
    env: env as unknown as RunEnv,
    runtimeState,
    userId: 'u',
    session,
    assistantMessageId: 'a',
    params,
    abort,
  }
  const lane = () => ensureSessionStores(runtimeState, session.id)
  return { args, launched, lane, abort }
}

describe('attemptOverflowRecovery — an oversized request reruns once under a checkpoint', () => {
  test('asks the lane for an overflow checkpoint and re-enters with the latch set', async () => {
    const h = checkpointHarness()
    const recovered = await attemptOverflowRecovery({
      ...h.args,
      error: new Error('prompt is too long: 250000 tokens > 200000 maximum'),
    })
    expect(recovered).toBe(true)
    expect(h.lane().context.checkpointDue).toBe('overflow')
    expect(h.launched).toHaveLength(1)
    expect(h.launched[0]!.chain.checkpointRecovered).toBe(true)
    expect(h.launched[0]!.chain.continuation).toBe(true)
    // No settled work: the failed row is reused and its incomplete response excluded.
    expect(h.launched[0]!.assistantMessageId).toBe('a')
    expect(h.launched[0]!.historyMessages.map((row) => row.id)).toEqual(['u'])
  })

  test('a local refusal the checkpoint can shrink is recovered the same way', async () => {
    const h = checkpointHarness()
    expect(
      await attemptOverflowRecovery({
        ...h.args,
        error: localRefusal('estimated_context_too_large'),
      }),
    ).toBe(true)
    expect(h.lane().context.checkpointDue).toBe('overflow')
  })

  // Even the checkpointed view did not fit: another checkpoint → overflow round would loop.
  test('the latch stops a second rerun on the same turn', async () => {
    const h = checkpointHarness({ checkpointRecovered: true })
    expect(
      await attemptOverflowRecovery({ ...h.args, error: new Error('prompt is too long') }),
    ).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.lane().context.checkpointDue).toBeUndefined()
  })

  test('a failure that is not about size is left to finalize', async () => {
    const h = checkpointHarness()
    expect(await attemptOverflowRecovery({ ...h.args, error: new Error('boom') })).toBe(false)
    expect(
      await attemptOverflowRecovery({ ...h.args, error: localRefusal('active_turn_too_large') }),
    ).toBe(false)
    expect(h.launched).toHaveLength(0)
  })

  test('Stop before the relaunch launches nothing and leaves no checkpoint request', async () => {
    const h = checkpointHarness()
    h.abort.abort('stop')
    expect(
      await attemptOverflowRecovery({ ...h.args, error: new Error('prompt is too long') }),
    ).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.lane().context.checkpointDue).toBeUndefined()
  })
})

describe('attemptSilentEmptyRecovery — a silently empty run reruns once under a checkpoint', () => {
  test('asks the lane for an empty-run checkpoint and re-enters with the latch set', async () => {
    const h = checkpointHarness()
    expect(await attemptSilentEmptyRecovery(h.args)).toBe(true)
    expect(h.lane().context.checkpointDue).toBe('empty_run')
    expect(h.launched).toHaveLength(1)
    expect(h.launched[0]!.chain.checkpointRecovered).toBe(true)
  })

  test('the latch stops a second rerun on the same turn', async () => {
    const h = checkpointHarness({ checkpointRecovered: true })
    expect(await attemptSilentEmptyRecovery(h.args)).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.lane().context.checkpointDue).toBeUndefined()
  })
})

describe('shouldTransientRetry', () => {
  const transient = { retryable: true, kind: 'fatal' }

  test('retries a plain transient fault under the cap', () => {
    expect(shouldTransientRetry(transient, 0, false)).toBe(true)
    expect(shouldTransientRetry(transient, undefined, false)).toBe(true)
    expect(shouldTransientRetry(transient, MAX_TRANSIENT_RETRIES - 1, false)).toBe(true)
  })

  test('stops at the retry cap', () => {
    expect(shouldTransientRetry(transient, MAX_TRANSIENT_RETRIES, false)).toBe(false)
  })

  test('never retries non-retryable, rate-limited, overflow, or aborted', () => {
    expect(shouldTransientRetry({ retryable: false, kind: 'fatal' }, 0, false)).toBe(false)
    expect(
      shouldTransientRetry({ retryable: true, rateLimited: true, kind: 'fatal' }, 0, false),
    ).toBe(false)
    expect(shouldTransientRetry({ retryable: true, kind: 'context_overflow' }, 0, false)).toBe(
      false,
    )
    expect(shouldTransientRetry(transient, 0, true)).toBe(false)
  })
})

// `runner.run()` RETHROWS when the chain carries no completion, and only the wake queue
// supplies one — a user-initiated run has none. So the retry launched here inherits
// `params` without a completion, and a `void`ed launch left its rejection unhandled.
// `bun` treats an unhandled rejection as fatal (measured: exit 1) and this app installs no
// handler, so a failure on the RECOVERY path — the code that runs precisely because the run
// already hit a transient fault — took down the API server and every other session in it.
// The service's own dispatch sites attach `logRunStartFailure` for exactly this shape.
describe('attemptTransientRetry — a failed relaunch must not be fatal', () => {
  test('reports a rejecting relaunch instead of leaving it unhandled', async () => {
    const abort = new AbortController()
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    let launched = false
    try {
      const retried = await attemptTransientRetry({
        wait: async () => {},
        // A 5xx classifies as transient-retryable (rate-limited would forbid the retry).
        error: Object.assign(new Error('upstream 503'), { status: 503 }),
        env: {
          deps: {},
          repo: { listMessages: async () => [] },
          state: { activeRuns: new Map(), activeRunSessions: new Map() },
          // No completion reaches this, so the real `run` would rethrow. Model that.
          run: () => {
            launched = true
            return Promise.reject(new Error('relaunch failed'))
          },
        },
        runtimeState: { activeRuns: new Map(), activeRunSessions: new Map() },
        userId: 'u1',
        session: { ...sessionFixture(), id: 's1' },
        assistantMessageId: 'm1',
        abort,
        params: {
          userId: 'u1',
          session: { ...sessionFixture(), id: 's1' },
          historyMessages: [],
          assistantMessageId: 'm1',
          scope: {},
          chain: { transientRetryCount: 0 },
        },
      } as never)
      expect(retried).toBe(true)
      expect(launched).toBe(true)
      // Let the rejection settle — an unattached handler surfaces here.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      console.warn = originalWarn
    }
    expect(warnings.flat().some((arg) => String(arg).includes('relaunch'))).toBe(true)
  })
})

describe('prepareRetryContinuation', () => {
  const message = (id: string, role: 'user' | 'assistant'): PersistedMessage => ({
    id,
    sessionId: 's1',
    userId: 'u1',
    payload: {
      id,
      role,
      from: role === 'user' ? USER_AUTHOR : DEFAULT_AGENT_AUTHOR,
      content: role === 'user' ? 'go' : 'completed tool work',
    },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  })

  test('keeps the completed assistant row in history and inserts a fresh durable retry row', async () => {
    const rows = [message('u1', 'user'), message('old-assistant', 'assistant')]
    const inserted: PersistedMessage[] = []
    const published: Array<{ type: string; sessionId: string; message: PersistedMessage }> = []
    const result = await prepareRetryContinuation({
      agent: DEFAULT_AGENT_AUTHOR,
      env: {
        now: () => '2026-07-22T00:01:00.000Z',
        repo: {
          listMessages: async () => rows,
          insertMessage: async (row: PersistedMessage) => void inserted.push(row),
        },
        deps: {
          streamRegistry: {
            publish: (
              _u: string,
              _s: string,
              event: { type: string; sessionId: string; message: PersistedMessage },
            ) => void published.push(event),
          },
        },
      } as never,
      userId: 'u1',
      sessionId: 's1',
      assistantMessageId: 'old-assistant',
      completedTurnCheckpoint: {
        payload: rows[1]!.payload,
        createdAt: rows[1]!.createdAt,
      },
    })

    expect(result.historyMessages.map((row) => row.id)).toEqual(['u1', 'old-assistant'])
    expect(result.assistantMessageId).not.toBe('old-assistant')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      id: result.assistantMessageId,
      payload: { role: 'assistant', content: '' },
    })
    expect(published).toEqual([{ type: 'message.created', sessionId: 's1', message: inserted[0] }])
  })

  test('reuses and excludes the current row when no settled checkpoint exists', async () => {
    const rows = [message('u1', 'user'), message('empty-assistant', 'assistant')]
    let inserted = false
    const result = await prepareRetryContinuation({
      agent: DEFAULT_AGENT_AUTHOR,
      env: {
        now: () => 'never',
        repo: {
          listMessages: async () => rows,
          insertMessage: async () => {
            inserted = true
          },
        },
        deps: { streamRegistry: { publish: () => undefined } },
      } as never,
      userId: 'u1',
      sessionId: 's1',
      assistantMessageId: 'empty-assistant',
    })

    expect(result).toMatchObject({ assistantMessageId: 'empty-assistant' })
    expect(result.historyMessages.map((row) => row.id)).toEqual(['u1'])
    expect(inserted).toBe(false)
  })
})

test('restoring a recovery checkpoint also resets the live payload reference', () => {
  const failed = messageForRestore('failed', 'partial failed request')
  const checkpoint = messageForRestore('checkpoint', 'completed prefix')
  const state = { payload: failed.payload, currentPayload: failed.payload }

  restoreCompletedTurnCheckpoint(state, checkpoint.payload)

  expect(state.payload).toBe(checkpoint.payload)
  expect(state.currentPayload).toBe(checkpoint.payload)
})

function messageForRestore(id: string, content: string): PersistedMessage {
  return {
    id,
    sessionId: 's1',
    userId: 'u1',
    payload: { id, role: 'assistant', from: DEFAULT_AGENT_AUTHOR, content },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}
