import { describe, expect, spyOn, test } from 'bun:test'

import type { SessionRecord } from '../../repository'
import { createRouteCooldowns } from '../route-cooldowns'
import { finalizeFailedRun } from './finalize'
import { announceEmptyReply } from './finalize-notices'
import type { RunEnv } from './types'

const USER_ID = 'u1'
const SESSION_ID = 's1'
const ASSISTANT_ID = 'assistant-1'

/**
 * A failed run tells the reader WHAT went wrong in the assistant row. Whether trying again
 * is worth doing is a separate answer, and one only the host can give — it classified the
 * error. It used to compute `retryable` and drop it, so a dropped connection and a rejected
 * API key looked identical in the transcript: a sentence, and nothing to press.
 */
function setup(opts: { hasAssistantRow?: boolean; stopped?: boolean } = {}) {
  const inserted: Array<{ id: string; payload: Record<string, unknown> }> = []
  const session = { id: SESSION_ID, sessionKind: 'chat' } as unknown as SessionRecord
  const env = {
    state: {
      stoppedRuntimeSessionIds: new Set(opts.stopped ? [SESSION_ID] : []),
      routeCooldowns: createRouteCooldowns(),
    },
    deps: { streamRegistry: { publish: () => {} } },
    repo: {
      // Reads back what was written — which is what makes the deterministic id mean anything:
      // the insert path short-circuits on an existing row rather than relying on a unique index.
      getMessage: async (_userId: string, _sessionId: string, id: string) =>
        inserted.find((row) => row.id === id) ??
        (id === ASSISTANT_ID && opts.hasAssistantRow !== false
          ? { payload: { role: 'assistant', content: '' }, createdAt: '2026-01-01T00:00:00.000Z' }
          : null),
      insertMessage: async (message: { id: string; payload: Record<string, unknown> }) => {
        inserted.push(message)
      },
    },
    persistAndPublish: async () => {},
  } as unknown as RunEnv

  return {
    inserted,
    notices: () => inserted.map((row) => row.payload.systemNotice).filter(Boolean),
    run: (error: unknown) =>
      finalizeFailedRun({
        env,
        userId: USER_ID,
        session,
        route: ROUTE_A,
        assistantMessageId: ASSISTANT_ID,
        error,
        publishRuntimeSession: async () => {},
      }),
    cooldowns: env.state.routeCooldowns,
  }
}

const ROUTE_A = { providerConnectionId: 'conn-a', modelId: 'openai/gpt-5' }

/** What the classifier calls retryable: a transport failure, not a refusal. */
const transient = () => Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })

describe('a failed run says what happened, as the system', () => {
  test('the reason is the notice, and a transient one carries the retry', async () => {
    // The reason used to be written into the ASSISTANT row, so a raw upstream body rendered as
    // the agent's own reply. The row is still marked failed; it no longer speaks.
    const h = setup()
    await h.run(transient())
    const notice = h.notices()[0] as {
      kind: string
      tone: string
      text: string
      recovery?: string[]
    }
    expect(notice.kind).toBe('run_failed')
    expect(notice.recovery).toEqual(['retry'])
    // The button says it; prose standing in for the control ("Trying again may work.", a
    // terminal "Retrying…") is gone. A failure a retry may fix reads as a warning.
    expect(notice.text).toBe('Network connection to the provider dropped.')
    expect(notice.tone).toBe('warning')
  })

  test('a raw provider body never becomes the reason; it is detail only', async () => {
    const h = setup()
    spyOn(console, 'error').mockImplementation(() => {})
    await h.run(new Error('418: {"error":{"message":"I am a teapot"}}'))
    const notice = h.notices()[0] as { text: string; detail?: string; tone: string }
    expect(notice.text).toBe('The run stopped on an unexpected error.')
    expect(notice.detail).toContain('teapot')
    // Trying again cannot help: the same tone the Event Center row has.
    expect(notice.tone).toBe('error')
  })

  test('the notice is keyed to the reply, so a second finalize does not stack another', async () => {
    const h = setup()
    await h.run(transient())
    await h.run(transient())
    expect(h.inserted.map((row) => row.id)).toEqual([`${ASSISTANT_ID}:failed`])
  })

  test('a terminal failure still says why, and offers no button', async () => {
    // Saying nothing was the defect: the person was left with a failed bubble and no reason.
    // Retrying an invalid key produces the same rejection, so the CONTROL is what is withheld —
    // a button that cannot work is worse than no button, because it reads as a promise.
    const h = setup()
    spyOn(console, 'error').mockImplementation(() => {})
    await h.run(Object.assign(new Error('provider 401: invalid api key'), { name: 'FetchError' }))
    const notice = h.notices()[0] as { kind: string; recovery?: string[] }
    expect(notice.kind).toBe('run_failed')
    // No Retry; the one thing that helps is fixing the key, where the connection lives.
    expect(notice.recovery).toEqual(['sign-in:conn-a'])
  })

  test('the agents read it: a failed attempt is a fact about their conversation', async () => {
    // Without it the next run inherits a failed row with no statement of what happened and
    // reads the half-finished work as somebody's completed turn.
    const h = setup()
    await h.run(transient())
    expect(h.inserted[0]!.payload.uiOnly).toBe(true)
    expect(h.inserted[0]!.payload.bindings).toHaveLength(1)
  })

  test('a user Stop is not a failure to recover from', async () => {
    const h = setup({ stopped: true })
    await h.run(transient())
    expect(h.notices()).toEqual([])
  })

  test('a 429 holds the ROUTE the run took, not the session: another route stays admitted', async () => {
    // Keyed per session, one participant's 429 on provider A held a participant of the same
    // conversation that runs on provider B.
    const h = setup()
    const now = Date.now()
    await h.run(Object.assign(new Error('provider 429: slow down'), { name: 'FetchError' }))
    expect(h.cooldowns.until(ROUTE_A, now)).toBeGreaterThan(now)
    expect(h.cooldowns.until({ providerConnectionId: 'conn-b', modelId: 'x/y' }, now)).toBeNull()
    // A transient 429 is per model: the connection's other models are still admitted.
    expect(h.cooldowns.until({ ...ROUTE_A, modelId: 'openai/gpt-5-mini' }, now)).toBeNull()
  })

  test('a spent plan holds every model on that connection, and only that connection', async () => {
    const h = setup()
    spyOn(console, 'error').mockImplementation(() => {})
    const now = Date.now()
    await h.run(
      Object.assign(new Error('provider 429: You exceeded your current quota, check billing.'), {
        name: 'FetchError',
      }),
    )
    expect(h.cooldowns.until({ ...ROUTE_A, modelId: 'openai/gpt-5-mini' }, now)).toBeGreaterThan(
      now,
    )
    expect(h.cooldowns.until({ ...ROUTE_A, providerConnectionId: 'conn-b' }, now)).toBeNull()
  })

  test('a run that died before producing a reply still says why, and offers no retry', async () => {
    // It used to say nothing: the reason went to the log and an ephemeral frame, and the
    // person came back to their own message with nothing under it. `regenerate` rewinds from
    // the assistant row and answers 409 without one, so the line carries no Retry.
    const h = setup({ hasAssistantRow: false })
    spyOn(console, 'warn').mockImplementation(() => {})
    await h.run(transient())
    expect(h.notices()).toEqual([
      expect.objectContaining({
        kind: 'run_failed',
        text: 'Network connection to the provider dropped.',
      }),
    ])
    expect((h.notices()[0] as { recovery?: unknown }).recovery).toBeUndefined()
  })
})

describe('a run that produced nothing', () => {
  test('is reported as a system notice, not as a sentence in the agent’s voice', async () => {
    const inserted: Array<{ payload: Record<string, unknown> }> = []
    const env = {
      deps: { streamRegistry: { publish: () => {} } },
      repo: {
        getMessage: async () => null,
        insertMessage: async (message: { payload: Record<string, unknown> }) => {
          inserted.push(message)
        },
      },
    } as unknown as RunEnv
    await announceEmptyReply({
      env,
      userId: USER_ID,
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_ID,
    })
    expect(inserted[0]?.payload.systemNotice).toMatchObject({
      kind: 'run_failed',
      tone: 'warning',
      text: 'The agent ended its turn without a reply.',
      recovery: ['retry'],
    })
  })
})
