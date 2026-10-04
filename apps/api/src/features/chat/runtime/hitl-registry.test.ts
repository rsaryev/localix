import { describe, expect, test } from 'bun:test'
import { createHitlRegistry } from './hitl-registry'

// Minimal HumanInLoopRequestBase shape the registry/controller read.
const req = (id: string) => ({ id, kind: 'confirm', title: 'Proceed?', payload: {} }) as never

describe('createHitlRegistry', () => {
  test('tracks and clears request metadata', () => {
    const r = createHitlRegistry()
    r.trackRequest('root', 'm1', 'tc1', 'bash', req('q1'), 'alice', 'child')
    expect(r.getRequestMeta('q1')).toMatchObject({
      sessionId: 'root',
      sourceSessionId: 'child',
      toolName: 'bash',
      userId: 'alice',
    })
    r.clearRequest('q1')
    expect(r.getRequestMeta('q1')).toBeNull()
  })

  test("getPendingInteraction finds a session's pending request, null for others", async () => {
    const r = createHitlRegistry()
    const p = r.controller.request(req('q2'))
    p.catch(() => {})
    r.trackRequest('s2', 'm', 'tc', 'confirm', req('q2'))
    expect(r.getPendingInteraction('s2')).toMatchObject({
      requestId: 'q2',
      sourceSessionId: 's2',
      kind: 'confirm',
      title: 'Proceed?',
    })
    expect(r.getPendingInteraction('unknown-session')).toBeNull()
    r.respond('q2', { ok: true }) // settle so the promise never dangles
    await p
  })

  test('respond resolves the pending request and clears its meta', async () => {
    const r = createHitlRegistry()
    const p = r.controller.request(req('q3'))
    r.trackRequest('s3', 'm', 'tc', 'confirm', req('q3'), 'alice')
    r.respond('q3', { choice: 'yes' }, 'alice')
    await p // resolves without throwing
    expect(r.getRequestMeta('q3')).toBeNull()
  })

  test('respond by a different user is blocked (ownership gate)', async () => {
    const r = createHitlRegistry()
    const p = r.controller.request(req('q4'))
    p.catch(() => {})
    r.trackRequest('s4', 'm', 'tc', 'confirm', req('q4'), 'alice')
    expect(() => r.respond('q4', {}, 'mallory')).toThrow('no longer active')
    r.respond('q4', {}, 'alice') // owner can still respond → cleanup
    await p
  })

  test('respond / dismiss on an unknown request throws', () => {
    const r = createHitlRegistry()
    expect(() => r.respond('nope', {})).toThrow('no longer active')
    expect(() => r.dismiss('nope')).toThrow('no longer active')
  })

  test('dismiss rejects the pending request and clears its meta', () => {
    const r = createHitlRegistry()
    const p = r.controller.request(req('q5'))
    r.trackRequest('s5', 'm', 'tc', 'confirm', req('q5'))
    r.dismiss('q5')
    expect(p).rejects.toThrow()
    expect(r.getRequestMeta('q5')).toBeNull()
  })
})

/**
 * Only respond/dismiss announced `hitl.resolved`, so a request that expired or whose run was
 * aborted kept its card and its Event Center row live. `clearRequest` is the seam every ending
 * passes; it must announce exactly the endings nobody else announced.
 */
describe('a request cleared without an answer is announced once', () => {
  const recording = () => {
    const cleared: { requestId: string; sessionId: string; reason: string }[] = []
    const r = createHitlRegistry({
      onClearedUnanswered: ({ requestId, meta, reason }) =>
        cleared.push({ requestId, sessionId: meta.sessionId, reason }),
    })
    return { r, cleared }
  }

  test('an aborted run clears its request as cancelled, on the rendering session', async () => {
    const { r, cleared } = recording()
    const abort = new AbortController()
    const p = r.controller.request(req('qa'), abort.signal)
    r.trackRequest('root', 'm', 'tc', 'confirm', req('qa'), 'alice', 'child')
    abort.abort()
    await p.catch(() => {})
    r.clearRequest('qa')
    expect(cleared).toEqual([{ requestId: 'qa', sessionId: 'root', reason: 'cancelled' }])
  })

  test('a request past its deadline clears as expired', () => {
    const { r, cleared } = recording()
    const expired = { ...(req('qe') as object), expiresAt: Date.now() - 1 } as never
    r.trackRequest('s', 'm', 'tc', 'confirm', expired)
    r.clearRequest('qe')
    expect(cleared).toEqual([{ requestId: 'qe', sessionId: 's', reason: 'expired' }])
  })

  test('an answered or dismissed request is not announced again, nor a second clear', async () => {
    const { r, cleared } = recording()
    const answered = r.controller.request(req('q1'))
    r.trackRequest('s', 'm', 'tc', 'confirm', req('q1'))
    r.respond('q1', {})
    await answered
    r.clearRequest('q1')
    const dismissed = r.controller.request(req('q2'))
    dismissed.catch(() => {})
    r.trackRequest('s', 'm', 'tc', 'confirm', req('q2'))
    r.dismiss('q2')
    r.clearRequest('q2')
    // A tool end clears by call id whether or not it ever asked.
    r.clearRequest('never-tracked')
    expect(cleared).toEqual([])

    const once = recording()
    once.r.trackRequest('s', 'm', 'tc', 'confirm', req('q3'))
    once.r.clearRequest('q3')
    once.r.clearRequest('q3')
    expect(once.cleared).toHaveLength(1)
  })
})

/**
 * An approval card's payload is built from the RAW tool input (`permission-gate.ts` passes
 * `command: call.command`), and three consumers read it: the `hitl.requested` frame every client
 * receives, every enabled plugin's `onHitlRequest` hook, and `listPendingInteractions`, which the
 * session detail replays on reconnect. All three used to get the credential verbatim while the
 * transcript item beside them was shielded.
 */
describe('the shown copy of a request is shielded, the tracked one is not', () => {
  const SECRET = 'sk-live-abcdef123456'
  const withShield = () =>
    createHitlRegistry({
      sanitizePayload: (_userId, payload) =>
        JSON.parse(JSON.stringify(payload).split(SECRET).join('[vault-secret]')),
    })
  const cardFor = (command: string) =>
    ({ id: 'q-card', kind: 'confirm', title: 'Run it?', payload: { command, cwd: '/w' } }) as never

  test('trackRequest returns the shielded copy and leaves the caller‘s object alone', () => {
    const r = withShield()
    const raw = cardFor(`PGPASSWORD=${SECRET} psql -h db`)
    const shown = r.trackRequest('s', 'm', 'tc', 'bash', raw, 'alice')

    expect(JSON.stringify(shown.payload)).not.toContain(SECRET)
    expect(JSON.stringify(shown.payload)).toContain('psql -h db')
    // The safety check (`isDangerous`) and the awaiting tool read the raw request — it must not have
    // been mutated in place.
    expect(JSON.stringify((raw as { payload: unknown }).payload)).toContain(SECRET)
  })

  test('the reconnect list reads the shielded copy, not the controller‘s request', async () => {
    const r = withShield()
    const raw = cardFor(`curl -H "X-Api-Key: ${SECRET}"`)
    const pending = r.controller.request(raw)
    pending.catch(() => {})
    r.trackRequest('s', 'm', 'tc', 'bash', raw, 'alice')

    const list = r.listPendingInteractions('s')
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list[0]?.payload)).not.toContain(SECRET)
    expect(JSON.stringify(r.getPendingInteraction('s'))).not.toContain(SECRET)

    r.respond('q-card', { approved: true }, 'alice')
    await pending
  })

  test('clearing a request drops the shielded copy too', async () => {
    // The first version never called `controller.request`, so `listPendingInteractions` returned []
    // whatever `clearRequest` did — it passed with the delete removed. A review caught that. The list
    // is driven by the CONTROLLER's pending set, so the request must actually be pending.
    const r = withShield()
    const raw = cardFor(`echo ${SECRET}`)
    const pending = r.controller.request(raw)
    pending.catch(() => {})
    r.trackRequest('s', 'm', 'tc', 'bash', raw, 'alice')
    expect(r.listPendingInteractions('s')).toHaveLength(1)

    r.clearRequest('q-card')
    // Still pending in the controller, but no longer OURS: the meta is gone, so the session filter
    // drops it — and the shielded copy is gone with it rather than lingering in the map.
    expect(r.listPendingInteractions('s')).toEqual([])
    r.respond('q-card', { approved: true }, 'alice')
    await pending.catch(() => {})
  })

  test('an ask/quiz payload is NOT redacted — it defines the answer domain', () => {
    // The regression this rule exists to prevent. The client submits the option VALUE it was shown
    // (`AskInteractionView`/`QuizInteractionView`), and `tools/hitl/ask.ts` filters
    // the answer against `optionValue` of its own RAW input. Redact an option and the submitted value
    // fails that allowlist: `selectedOptions` collapses to `[]` and the model is told "(no selection)"
    // with no error anywhere — and `quiz` scores it wrong.
    const r = withShield()
    const ask = {
      id: 'q-ask',
      kind: 'ask',
      title: 'Which connection?',
      payload: {
        questions: [
          { id: 'q1', question: 'Which?', options: [{ value: `postgres://u:${SECRET}@db/app` }] },
        ],
      },
    } as never
    const shown = r.trackRequest('s', 'm', 'tc', 'ask', ask, 'alice')
    // Verbatim, because the value has to survive the round trip.
    expect(JSON.stringify(shown.payload)).toContain(SECRET)
    expect(JSON.stringify(r.listPendingInteractions('s'))).not.toContain('[vault-secret]')
  })

  test('request_secret is left alone too — its payload is what the submit route matches on', () => {
    const r = withShield()
    const req = {
      id: 'q-secret',
      kind: 'request_secret',
      title: 'Need a key',
      payload: { key: 'STRIPE_KEY', reason: 'call the API' },
    } as never
    expect(r.trackRequest('s', 'm', 'tc', 'vault', req, 'alice')).toBe(req)
  })

  test('with no sanitizer the payload is returned unchanged — no accidental copying', () => {
    const r = createHitlRegistry()
    const raw = cardFor('ls -la')
    expect(r.trackRequest('s', 'm', 'tc', 'bash', raw, 'alice')).toBe(raw)
  })
})

/**
 * `hitl.requested` is replayable, so a client that was away receives it on reconnect. Without the
 * fact's own time the notification layer stamps `Date.now()` (`agentNotificationEnvelope`'s default),
 * the TTL in the notifications policy sees a brand-new envelope, and a question asked hours ago —
 * possibly already answered — raises a native banner as if it had just been asked. Same reason
 * `terminal.finished` carries `finishedAt`.
 */
describe('a surfaced confirm frame carries when it was asked', () => {
  test('requestedAt is the REQUEST’s own creation time, not a second clock reading', async () => {
    const { surfaceConfirmRequest } = await import('./hitl-confirm')
    const { createHitlRegistry } = await import('./hitl-registry')
    const published: Array<Record<string, unknown>> = []

    const before = Date.now()
    const request = surfaceConfirmRequest({
      hitlRegistry: createHitlRegistry(),
      streamRegistry: {
        publish: (_userId: string, _sessionId: string, event: Record<string, unknown>) => {
          published.push(event)
        },
      } as never,
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      toolCallId: 'call-1',
      toolName: 'bash',
      title: 'Run a destructive command?',
      payload: { command: 'rm -rf build' } as never,
    })

    expect(published).toHaveLength(1)
    const frame = published[0]!
    expect(frame.type).toBe('hitl.requested')
    // Equal to the tracked request's createdAt — the two cannot drift, which is the point of reading
    // it from the request instead of calling the clock again.
    expect(frame.requestedAt).toBe(request.createdAt)
    // …and it is a real reading, so a hard-coded or zero value cannot pass.
    expect(frame.requestedAt as number).toBeGreaterThanOrEqual(before)
    expect(frame.requestedAt as number).toBeLessThanOrEqual(Date.now())
  })
})
