import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  parseNotificationPreferences,
  type NotificationChannel,
  type NotificationTransport,
} from './contracts'
import { applicationConditionEnvelope, applicationNotificationEnvelope } from './application-events'
import { agentNotificationEnvelope } from './events'
import { notificationChannels } from './policy'
import { createNotificationRouter } from './router'
import {
  createTerminalNotificationTransport,
  detectTerminalNotificationCapability,
  encodeTerminalNotification,
} from './terminal'

const channels = (...values: NotificationChannel[]) => new Set(values)

function context(over: Partial<Parameters<typeof notificationChannels>[1]> = {}) {
  return {
    now: 1_000,
    focused: false as boolean | 'unknown',
    quiet: false,
    ...over,
  }
}

describe('agent notification domain', () => {
  it('normalizes completion, failure and HITL with durable semantics + declarative actions', () => {
    const completed = agentNotificationEnvelope(
      { type: 'run.completed', sessionId: 's1', runId: 'm1', sessionTitle: 'Ship it' },
      1_000,
    )
    expect(completed.event).toMatchObject({
      topic: 'run.completed',
      severity: 'success',
      persistence: 'durable',
      dedupeKey: 'run.completed:s1:m1',
      actions: [{ kind: 'open_deep_link', uri: 'localix://session/s1' }],
      source: { resource: { kind: 'run', id: 'm1' } },
    })

    const failed = agentNotificationEnvelope(
      { type: 'run.failed', sessionId: 's1', runId: 'm2', error: 'rate limited' },
      1_000,
    )
    expect(failed.event.severity).toBe('error')
    expect(failed.event.body).toBe('rate limited')
    expect(failed.event.actions.map((action) => action.kind)).toEqual([
      'open_deep_link',
      'retry_run',
    ])

    const hitl = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 's2', requestId: 'r1', requestTitle: 'Approve?' },
      1_000,
    )
    expect(hitl.event).toMatchObject({
      topic: 'hitl.required',
      severity: 'warning',
      dedupeKey: 'hitl.required:s2:r1',
      source: { resource: { kind: 'interaction', id: 'r1' } },
    })
    expect(hitl.event.actions.map((action) => action.kind)).toEqual([
      'open_deep_link',
      'respond_hitl',
    ])

    const child = agentNotificationEnvelope(
      { type: 'child.completed', sessionId: 'child-1', sessionTitle: 'Review auth' },
      1_000,
    )
    expect(child.event).toMatchObject({
      topic: 'child.completed',
      source: { kind: 'agent_child', sessionId: 'child-1' },
      dedupeKey: 'child.completed:child-1:unscoped',
      actions: [{ kind: 'open_deep_link', uri: 'localix://session/child-1' }],
    })

    const terminal = agentNotificationEnvelope(
      {
        type: 'terminal.finished',
        sessionId: 's-terminal',
        terminalId: 'pty-1',
        exitCode: 7,
        command: 'bun test',
      },
      1_000,
    )
    expect(terminal.event).toMatchObject({
      topic: 'terminal.finished',
      severity: 'error',
      title: 'Background terminal exited (7)',
      body: 'bun test',
      source: { kind: 'background_terminal', sessionId: 's-terminal' },
      dedupeKey: 'terminal.finished:s-terminal:pty-1',
    })
    expect(terminal.event.source).toMatchObject({ resource: { kind: 'terminal', id: 'pty-1' } })
  })

  it('keys a child ending by its run, so a second run of the same sub-agent is its own row', () => {
    // The key was `child.completed:<session>`, and the router dropped a resumed sub-agent's second
    // completion as a replay of the first.
    const first = agentNotificationEnvelope({
      type: 'child.completed',
      sessionId: 'child-1',
      runId: 'r1',
    })
    const second = agentNotificationEnvelope({
      type: 'child.completed',
      sessionId: 'child-1',
      runId: 'r2',
    })
    expect(first.event.dedupeKey).toBe('child.completed:child-1:r1')
    expect(second.event.dedupeKey).not.toBe(first.event.dedupeKey)
  })

  it('records a stopped child as information, never as an interruption', () => {
    const stopped = agentNotificationEnvelope(
      { type: 'child.stopped', sessionId: 'child-1', runId: 'r1', sessionTitle: 'Review auth' },
      1_000,
    )
    expect(stopped.event).toMatchObject({
      topic: 'child.stopped',
      severity: 'info',
      title: 'Sub-agent stopped',
      dedupeKey: 'child.stopped:child-1:r1',
    })
    expect(
      notificationChannels(stopped, context(), channels('history', 'toast', 'native')),
    ).toEqual(channels('history'))
  })

  it('carries the failed run on its Retry, so Retry can tell whether that run is still the latest', () => {
    const failed = agentNotificationEnvelope({ type: 'run.failed', sessionId: 's1', runId: 'm2' })
    expect(failed.event.actions.find((action) => action.kind === 'retry_run')).toMatchObject({
      sessionId: 's1',
      runId: 'm2',
    })
  })

  it('never interrupts for a question past its own deadline', () => {
    // The lifetime was a flat hour, so a card that expired after five minutes could still raise a
    // banner asking for an answer nothing would accept any more.
    const hitl = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 's2', requestId: 'r1', expiresAt: 1_000 + 5 * 60_000 },
      1_000,
    )
    expect(hitl.event.ttlMs).toBe(5 * 60_000)
    const later = context({ now: 1_000 + 6 * 60_000 })
    expect(notificationChannels(hitl, later, channels('history', 'native'))).toEqual(
      channels('history'),
    )
    const lapsed = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 's2', requestId: 'r2', expiresAt: 500 },
      1_000,
    )
    expect(lapsed.event.ttlMs).toBe(0)
    const open = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 's2', requestId: 'r3' },
      1_000,
    )
    expect(open.event.ttlMs).toBe(60 * 60_000)
  })
})

describe('notification policy + router', () => {
  const envelope = agentNotificationEnvelope(
    { type: 'run.completed', sessionId: 's1', runId: 'm1', sessionTitle: 'Done' },
    1_000,
  )

  it('retains durable history but suppresses interruptive routes when focused/quiet', () => {
    expect([
      ...notificationChannels(envelope, context({ focused: true }), channels('history', 'native')),
    ]).toEqual(['history'])
    expect([
      ...notificationChannels(
        envelope,
        context({ focused: false, quiet: true }),
        channels('history', 'toast', 'native', 'terminal'),
      ),
    ]).toEqual(['history'])
  })

  it('records routine success without sending it to any interruptive adapter', () => {
    expect([
      ...notificationChannels(
        envelope,
        context({ condition: 'always' }),
        channels('history', 'toast', 'native', 'terminal'),
      ),
    ]).toEqual(['history'])
  })

  it('interrupts for errors and HITL only', () => {
    const failed = agentNotificationEnvelope(
      { type: 'run.failed', sessionId: 'failed', runId: 'm2' },
      1_000,
    )
    expect([
      ...notificationChannels(
        failed,
        context({ condition: 'always' }),
        channels('history', 'toast', 'native', 'terminal'),
      ),
    ]).toEqual(['history', 'toast', 'native', 'terminal'])

    const hitl = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 'hitl', requestId: 'r1' },
      1_000,
    )
    expect([
      ...notificationChannels(
        hitl,
        context({ focused: 'unknown' }),
        channels('history', 'toast', 'native', 'terminal'),
      ),
    ]).toEqual(['history', 'toast', 'native', 'terminal'])
  })

  it('decides "waiting on the person" by the human-input category, not the topic', () => {
    const available = channels('history', 'native')
    const hitl = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 's', requestId: 'r' },
      1_000,
    )
    const mention = agentNotificationEnvelope(
      { type: 'user.mentioned', sessionId: 's', messageId: 'm', from: 'lead' },
      1_000,
    )
    expect(hitl.event.category).toBe('human-input')
    expect(mention.event.category).toBe('human-input')
    // The same topic without the category is reporting, not waiting: no interruption.
    const { category: _category, ...uncategorized } = hitl.event
    expect([
      ...notificationChannels({ ...hitl, event: uncategorized }, context(), available),
    ]).toEqual(['history'])
    // Any topic filed as human-input interrupts — a new kind of waiting needs no policy edit.
    const plan = { ...hitl, event: { ...hitl.event, topic: 'child.completed' as const } }
    expect([...notificationChannels(plan, context(), available)]).toEqual(['history', 'native'])
  })

  it('applies always | unfocused | off only to interruptions, never durable history', () => {
    const failed = agentNotificationEnvelope(
      { type: 'run.failed', sessionId: 'failed', runId: 'm2' },
      1_000,
    )
    const available = channels('history', 'toast', 'native', 'terminal')
    expect([
      ...notificationChannels(failed, context({ focused: true, condition: 'always' }), available),
    ]).toEqual(['history', 'toast', 'native', 'terminal'])
    expect([
      ...notificationChannels(
        failed,
        context({ focused: true, condition: 'unfocused' }),
        available,
      ),
    ]).toEqual(['history'])
    expect([
      ...notificationChannels(failed, context({ focused: false, condition: 'off' }), available),
    ]).toEqual(['history'])
  })

  it('forgets a settled condition so it can be reported again, keeping the one still true', async () => {
    const history: NotificationTransport = {
      id: 'h',
      channel: 'history',
      capabilities: new Set(),
      deliver() {},
    }
    const router = createNotificationRouter()
    const a = applicationConditionEnvelope('error', 'a', undefined, 'db:x:a', 1_000)
    const b = applicationConditionEnvelope('error', 'b', undefined, 'db:x:b', 1_000)
    await router.route(a, context(), [history])
    await router.route(b, context(), [history])
    router.forget('application.condition:db:x:', b.event.dedupeKey)
    expect((await router.route(a, context({ now: 1_001 }), [history])).status).toBe('delivered')
    expect((await router.route(b, context({ now: 1_001 }), [history])).status).toBe('deduplicated')
  })

  it('deduplicates replayed envelopes, drops expired ones, and isolates transport failure', async () => {
    const delivered: string[] = []
    const transport = (id: string, fail = false): NotificationTransport => ({
      id,
      channel: 'history',
      capabilities: new Set(),
      deliver() {
        if (fail) throw new Error('broken')
        delivered.push(id)
      },
    })
    const router = createNotificationRouter()
    const first = await router.route(envelope, context(), [transport('ok'), transport('bad', true)])
    expect(first.status).toBe('delivered')
    expect(first.delivered).toEqual(['ok'])
    expect(first.failed.map((failure) => failure.transportId)).toEqual(['bad'])
    expect(delivered).toEqual(['ok'])

    expect(
      (await router.route(envelope, context({ now: 1_001 }), [transport('again')])).status,
    ).toBe('deduplicated')
    const nextRun = agentNotificationEnvelope(
      { type: 'run.completed', sessionId: 's1', runId: 'm2' },
      1_001,
    )
    expect((await router.route(nextRun, context({ now: 1_001 }), [transport('next')])).status).toBe(
      'delivered',
    )
    // An expired envelope whose fact was already delivered is DEDUPLICATED, not re-reported as
    // expired — the dedupe check now runs first, because the TTL no longer short-circuits the route.
    const expired = { ...envelope, occurredAt: 0, event: { ...envelope.event, ttlMs: 10 } }
    expect((await router.route(expired, context(), [transport('late')])).status).toBe(
      'deduplicated',
    )
  })

  /**
   * The long-autonomy signal this package exists to carry. Every notification-producing frame is
   * `replayable` (`session-stream-registry`'s REPLAY_TIER), so a run that finishes while nobody is
   * connected is delivered on RECONNECT. These fixtures pass `occurredAt` explicitly (`0`), which is
   * what a producer SHOULD do — and now what every producer DOES: run frames carry `finishedAt`,
   * HITL carries `requestedAt`, terminal carries `finishedAt`, and child events pass their own
   * `updatedAt` (see the note in policy.ts). The TTL used to drop that envelope in the router
   * before the policy was even consulted, so coming back more than 10 minutes after a background
   * sub-agent finished left NO bell entry and no badge — and the Notification Center is
   * client-side localStorage with no server-side history to recover from.
   */
  describe('an expired DURABLE fact is still recorded', () => {
    const stale = (topicRunId: string) =>
      agentNotificationEnvelope({ type: 'run.completed', sessionId: 's1', runId: topicRunId }, 0)

    const history = (delivered: string[]): NotificationTransport => ({
      id: 'center',
      channel: 'history',
      capabilities: new Set(['persistence']),
      deliver() {
        delivered.push('center')
      },
    })
    const native = (delivered: string[]): NotificationTransport => ({
      id: 'os',
      channel: 'native',
      capabilities: new Set(),
      deliver() {
        delivered.push('os')
      },
    })

    it('reaches history but NOT toast, native or terminal', async () => {
      const delivered: string[] = []
      const router = createNotificationRouter()
      const report = await router.route(
        stale('stale-1'),
        context({ now: 60 * 60_000, focused: false, condition: 'always' }),
        [
          history(delivered),
          { ...native(delivered), id: 'toast', channel: 'toast' },
          native(delivered),
        ],
      )
      expect(report.status).toBe('delivered')
      expect(delivered).toEqual(['center'])
    })

    it('the policy alone says the same thing — history yes, interruption no', () => {
      const late = context({ now: 60 * 60_000, focused: false, condition: 'always' })
      expect([
        ...notificationChannels(
          stale('stale-2'),
          late,
          new Set(['history', 'toast', 'native', 'terminal']),
        ),
      ]).toEqual(['history'])
    })

    it('with no history transport there is nothing to record, and that is reported as expired', async () => {
      // The `expired` status still exists and is still reachable — it now means "nothing could be
      // delivered AND the envelope was past its TTL", which is what a caller wants to distinguish
      // from a preference-based suppression.
      const delivered: string[] = []
      const router = createNotificationRouter()
      const report = await router.route(stale('stale-3'), context({ now: 60 * 60_000 }), [
        native(delivered),
      ])
      expect(report.status).toBe('expired')
      expect(delivered).toEqual([])
    })
  })

  it('uses the centralized method while keeping auto capability-gated', () => {
    expect(
      detectTerminalNotificationCapability({
        isTTY: true,
        env: { TERM_PROGRAM: 'iTerm.app' },
        method: 'auto',
      }),
    ).toBeNull()
    expect(
      detectTerminalNotificationCapability({ isTTY: true, env: {}, method: 'osc777' }),
    ).toEqual({ protocol: 'osc777', terminal: 'generic' })
  })
})

describe('notification preferences contract', () => {
  it('uses conservative defaults', () => {
    expect(parseNotificationPreferences(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    expect(parseNotificationPreferences({ osNotifications: false })).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    )
  })

  it('retains valid fields and rejects malformed persisted/config values', () => {
    expect(parseNotificationPreferences({ condition: 'always', terminalMethod: 'bel' })).toEqual({
      condition: 'always',
      terminalMethod: 'bel',
    })
    expect(
      parseNotificationPreferences({ condition: 'sometimes', terminalMethod: 'shell' }),
    ).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
  })
})

describe('terminal capability adapter', () => {
  it('enables Warp only by capability detection and leaves unknown terminals inert', () => {
    expect(
      detectTerminalNotificationCapability({
        isTTY: true,
        env: { TERM_PROGRAM: 'WarpTerminal', WARP_CLIENT_VERSION: '0.2026.07.15.08.11' },
      }),
    ).toEqual({ protocol: 'osc777', terminal: 'warp' })
    expect(
      detectTerminalNotificationCapability({ isTTY: true, env: { TERM_PROGRAM: 'WarpTerminal' } }),
    ).toBeNull()
    expect(
      detectTerminalNotificationCapability({
        isTTY: true,
        env: { TERM_PROGRAM: 'WarpTerminal', WARP_CLIENT_VERSION: '   ' },
      }),
    ).toBeNull()
    expect(
      detectTerminalNotificationCapability({ isTTY: true, env: { TERM_PROGRAM: 'iTerm.app' } }),
    ).toBeNull()
    expect(
      detectTerminalNotificationCapability({
        isTTY: true,
        env: { TERM_PROGRAM: 'iTerm.app', LOCALIX_TERMINAL_NOTIFICATIONS: 'osc9' },
      }),
    ).toEqual({ protocol: 'osc9', terminal: 'generic' })
    expect(
      detectTerminalNotificationCapability({
        isTTY: true,
        env: { LOCALIX_TERMINAL_NOTIFICATIONS: 'bel' },
      }),
    ).toEqual({ protocol: 'bel', terminal: 'generic' })
    expect(
      detectTerminalNotificationCapability({
        isTTY: false,
        env: { TERM_PROGRAM: 'WarpTerminal', LOCALIX_TERMINAL_NOTIFICATIONS: 'osc777' },
      }),
    ).toBeNull()
  })

  it('encodes safe OSC 777 and writes through the transport', async () => {
    const envelope = agentNotificationEnvelope(
      { type: 'run.failed', sessionId: 's1', error: 'bad;\nnews' },
      1_000,
    )
    const capability = { protocol: 'osc777' as const, terminal: 'warp' as const }
    expect(encodeTerminalNotification(capability, envelope)).toBe(
      '\u001b]777;notify;Agent run failed;bad news\u0007',
    )
    expect(encodeTerminalNotification({ protocol: 'bel', terminal: 'generic' }, envelope)).toBe(
      '\u0007',
    )
    let output = ''
    await createTerminalNotificationTransport(capability, (value) => {
      output = value
    }).deliver(envelope)
    expect(output).toContain('Agent run failed')
  })
})

/**
 * The WIRING, not the policy. `agentNotificationEnvelope(trigger, occurredAt = Date.now())` makes the
 * timestamp optional, and for three of five producers that default was taken — so a replayed frame
 * (every notification-producing frame is `replayable`) looked brand new and the TTL below could never
 * suppress its interruption. The events now carry the fact's own time (`terminal.finished.finishedAt`,
 * `hitl.requested.requestedAt`, `run.*.finishedAt`); this asserts the ENVELOPE honours what a producer
 * passes, which is the half this package owns.
 */
describe('an envelope keeps the time its producer supplied', () => {
  it('does not overwrite an explicit occurredAt with the clock', () => {
    const asked = Date.now() - 3 * 60 * 60 * 1000
    const envelope = agentNotificationEnvelope(
      { type: 'hitl.required', sessionId: 's1', requestId: 'r1' },
      asked,
    )
    expect(envelope.occurredAt).toBe(asked)
    // And the id derives from it, so two deliveries of the SAME fact dedupe on replay.
    expect(envelope.id).toContain(asked.toString(36))
  })

  it('still dates an envelope when a producer supplies nothing', () => {
    // The fallback is deliberate — an envelope must never be undatable — but it is what makes a
    // stale replay indistinguishable from a fresh fact, which is why the producers pass a real time.
    const before = Date.now()
    const envelope = agentNotificationEnvelope({
      type: 'run.completed',
      sessionId: 's1',
      runId: 'm1',
    })
    expect(envelope.occurredAt).toBeGreaterThanOrEqual(before)
    expect(envelope.occurredAt).toBeLessThanOrEqual(Date.now())
  })
})

/**
 * Application-level notifications — what the app itself reports, as opposed to a fact about an
 * agent run. The builder exists so no surface has to reach for a raw toast: a bare
 * `sonnerToast.error` renders and vanishes, never entering the Notification Center and never
 * consulting the policy. The retry-failure path lost its error exactly that way.
 */
describe('application notification envelope', () => {
  it('is durable, so the record survives whatever the policy decides about interrupting', () => {
    const envelope = applicationNotificationEnvelope('error', 'Could not retry the agent run')
    expect(envelope.event.persistence).toBe('durable')
    expect(envelope.event.topic).toBe('application.notification')
    expect(envelope.event.source.kind).toBe('application')

    // Durable + error ⇒ recorded AND interrupting, with every channel offered.
    expect([
      ...notificationChannels(
        envelope,
        { now: envelope.occurredAt, focused: false, quiet: false },
        channels('history', 'toast', 'native', 'terminal'),
      ),
    ]).toEqual(['history', 'toast', 'native', 'terminal'])
  })

  it('does not collapse two distinct errors that share a message', () => {
    // Toast text is presentation, not identity. Dedupe is by key, so a shared message must not
    // make the second error disappear — it is a different incident.
    const first = applicationNotificationEnvelope('error', 'Request failed')
    const second = applicationNotificationEnvelope('error', 'Request failed')
    expect(first.event.dedupeKey).not.toBe(second.event.dedupeKey)
    expect(first.id).not.toBe(second.id)
  })

  it('carries the body through as the notification message', () => {
    const envelope = applicationNotificationEnvelope('warning', 'Title', 'the details')
    expect(envelope.event.body).toBe('the details')
    expect(applicationNotificationEnvelope('info', 'Title').event.body).toBeUndefined()
  })
})

describe('agentNotificationEnvelope source', () => {
  it('names the surface and resource of every trigger kind', () => {
    const source = (trigger: Parameters<typeof agentNotificationEnvelope>[0]) =>
      agentNotificationEnvelope(trigger).event.source
    expect(
      source({ type: 'user.mentioned', sessionId: 's', messageId: 'm', from: 'ana' }),
    ).toMatchObject({ kind: 'agent_mention', resource: { kind: 'message', id: 'm' } })
    expect(source({ type: 'child.stopped', sessionId: 's', runId: 'r' })).toEqual({
      kind: 'agent_child',
      resource: undefined,
      sessionId: 's',
      projectId: undefined,
    })
    expect(source({ type: 'run.failed', sessionId: 's' })).toMatchObject({
      kind: 'agent_run',
      resource: undefined,
    })
  })
})
