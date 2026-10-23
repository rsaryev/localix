import { describe, expect, test } from 'bun:test'
import { handleHitlRequest } from './event-handlers-hitl'
import { createHitlRegistry } from '../hitl-registry'

/**
 * The registry is the REAL one, not a hand-written fake. `trackRequest` returns the copy every
 * consumer must show — the shielded one — and a fake that returned something else (the first version
 * of this test returned `tracked.push(...)`, i.e. a number) silently made `publish` carry
 * `title: undefined` while still passing its own assertion shape.
 */
const realRegistry = (opts?: Parameters<typeof createHitlRegistry>[0]) => {
  const registry = createHitlRegistry(opts)
  const tracked: Array<{ sessionId: string; request: { title?: string; payload?: unknown } }> = []
  const trackRequest: typeof registry.trackRequest = (...args) => {
    const shown = registry.trackRequest(...args)
    tracked.push({ sessionId: args[0], request: shown })
    return shown
  }
  return { registry: { ...registry, trackRequest }, tracked }
}

describe('handleHitlRequest', () => {
  test('surfaces a nested subagent question on the root session with visible source context', async () => {
    const { registry, tracked } = realRegistry()
    const published: Array<{ sessionId: string; title: string; toolName: string }> = []
    const notifications: Array<{
      title?: string
      message?: string
      notificationType?: string
    }> = []

    handleHitlRequest(
      {
        env: {
          deps: {
            hitlRegistry: registry,
            streamRegistry: {
              publish: (
                _userId: string,
                sessionId: string,
                event: { request: { title: string }; toolName: string },
              ) =>
                published.push({
                  sessionId,
                  title: event.request.title,
                  toolName: event.toolName,
                }),
            },
          },
        },
        state: { hitlStartTimes: new Map<string, number>() },
        session: {
          id: 'nested-child',
          sessionKind: 'subagent',
          parentSessionId: 'first-child',
          rootSessionId: 'root',
          title: 'Audit auth flow',
        },
        hitlTargetSessionId: 'root',
        assistantMessageId: 'assistant-1',
        userId: 'user-1',
        miniAppHooksForRun: [],
        hookRunOptions: {},
        ccHooks: {
          runNotification: async (notification: {
            title?: string
            message?: string
            notificationType?: string
          }) => {
            notifications.push(notification)
          },
        },
      } as never,
      {
        type: 'human_in_loop_request',
        toolCallId: 'tool-1',
        toolName: 'ask',
        request: {
          id: 'request-1',
          kind: 'ask',
          title: 'Choose an implementation',
          payload: { questions: [] },
          createdAt: Date.now(),
        },
      } as never,
    )

    await Promise.resolve()
    const title = 'Sub-agent "Audit auth flow" needs input: Choose an implementation'
    expect(tracked.map((row) => ({ sessionId: row.sessionId, title: row.request.title }))).toEqual([
      { sessionId: 'root', title },
    ])
    expect(published).toEqual([{ sessionId: 'root', title, toolName: 'sub-agent · ask' }])
    expect(notifications).toEqual([
      {
        title,
        message: `Agent needs input: ${title}`,
        notificationType: 'agent_needs_input',
      },
    ])
  })

  test('routes request_secret through the same root channel without exposing a value', () => {
    const { registry, tracked } = realRegistry()
    const published: Array<{ sessionId: string; request: unknown }> = []
    handleHitlRequest(
      {
        env: {
          deps: {
            hitlRegistry: registry,
            streamRegistry: {
              publish: (_u: string, sessionId: string, event: { request: unknown }) =>
                published.push({ sessionId, request: event.request }),
            },
          },
        },
        state: { hitlStartTimes: new Map<string, number>() },
        session: { id: 'grandchild', sessionKind: 'subagent', title: 'Worker' },
        hitlTargetSessionId: 'root',
        assistantMessageId: 'm1',
        userId: 'owner',
        miniAppHooksForRun: [],
        hookRunOptions: {},
        ccHooks: { runNotification: async () => {} },
      } as never,
      {
        type: 'human_in_loop_request',
        toolCallId: 'secret-call',
        toolName: 'request_secret',
        request: {
          id: 'secret-call',
          kind: 'request_secret',
          payload: { key: 'API_KEY', reason: 'Call service' },
          createdAt: Date.now(),
        },
      } as never,
    )
    expect(tracked[0]?.sessionId).toBe('root')
    expect(published[0]?.sessionId).toBe('root')
    expect(JSON.stringify([tracked, published])).not.toContain('secret-value')
  })

  test('an ask payload reaches the wire VERBATIM — redacting it would break the answer', async () => {
    // The regression this pins: an earlier version of the test paired `kind: 'ask'` with
    // a `command` payload — a shape no producer emits — and so asserted redaction on the one kind that
    // must never be redacted. The client submits the option value it was SHOWN and the tool filters it
    // against `optionValue` of its own raw input, so a redacted option silently becomes "(no
    // selection)". Only `confirm` is shielded; its composition is pinned in confirm-requester.test.ts.
    const SECRET = 'sk-live-abcdef123456'
    const { registry } = realRegistry({
      sanitizePayload: (_userId, payload) =>
        JSON.parse(JSON.stringify(payload).split(SECRET).join('[vault-secret]')),
    })
    const published: unknown[] = []
    const hooked: unknown[] = []
    handleHitlRequest(
      {
        env: {
          deps: {
            hitlRegistry: registry,
            streamRegistry: {
              publish: (_u: string, _s: string, event: unknown) => published.push(event),
            },
          },
        },
        state: { hitlStartTimes: new Map<string, number>() },
        session: { id: 'root', sessionKind: 'chat', title: 'Chat' },
        hitlTargetSessionId: 'root',
        assistantMessageId: 'm1',
        userId: 'owner',
        miniAppHooksForRun: [
          { pluginName: 'p1', hooks: { onHitlRequest: (input: unknown) => hooked.push(input) } },
        ],
        hookRunOptions: {},
        ccHooks: { runNotification: async () => {} },
      } as never,
      {
        type: 'human_in_loop_request',
        toolCallId: 'call-1',
        toolName: 'ask',
        request: {
          id: 'call-1',
          kind: 'ask',
          title: 'Which connection?',
          payload: {
            questions: [
              { id: 'q1', question: 'Which?', options: [{ value: `postgres://u:${SECRET}@db` }] },
            ],
          },
          createdAt: Date.now(),
        },
      } as never,
    )

    await Promise.resolve()
    expect(published).toHaveLength(1)
    expect(hooked).toHaveLength(1)
    // Verbatim on every leg, because the value has to come back.
    expect(JSON.stringify(published)).toContain(SECRET)
    expect(JSON.stringify(hooked)).toContain(SECRET)
    expect(JSON.stringify(registry.listPendingInteractions('root'))).not.toContain('[vault-secret]')
  })

  test('invalid ancestry refuses to surface to an unverified session', () => {
    expect(() =>
      handleHitlRequest(
        {
          state: { hitlStartTimes: new Map<string, number>() },
          session: { id: 'orphan', sessionKind: 'subagent' },
          hitlTargetSessionId: null,
        } as never,
        {
          type: 'human_in_loop_request',
          toolCallId: 'ask-1',
          toolName: 'ask',
          request: { id: 'ask-1', kind: 'ask', payload: {}, createdAt: Date.now() },
        } as never,
      ),
    ).toThrow('invalid ancestry')
  })
})
