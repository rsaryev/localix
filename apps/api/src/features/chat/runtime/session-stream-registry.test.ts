import { describe, expect, test } from 'bun:test'
import { createSessionStreamRegistry, isLiveOnlyEvent } from './session-stream-registry'
import { requiresWatchedSession } from './session-stream-policy'
import type { AgentStreamEvent } from '../contracts'

/**
 * The COMPILE-TIME half of this guard is `REPLAY_TIER` itself: a `Record<AgentStreamEvent['type'],
 * …>` in session-stream-registry.ts, so a new variant in `contracts.ts` cannot be added without
 * classifying it. It runs on `bun run type-check`, not just here.
 *
 * This is the RUNTIME half: each named frame is checked through `isLiveOnlyEvent`, and the
 * replayable ones below must never read as live-only.
 */
describe('isLiveOnlyEvent', () => {
  const EXPECTED_LIVE_ONLY: AgentStreamEvent['type'][] = [
    'message.delta', // no meaning without the snapshot it extends
    'child_session.activity', // transient "doing now" label
    'lsp.diagnostics', // re-pushed when the editor reopens the file
    'fs.changed', // client remounts the tree from a fresh listDirectory
    'terminal.opened', // one-shot "adopt + reveal this PTY"
    'terminal.waiting', // transient wait activity
    'terminal.input', // transient interaction marker; never carries literal input
    'terminal.state', // last-wins alt-screen/URL flip; the client re-reads the registry on reconnect
    'preview.command', // correlated commands must never execute again on reconnect
    'plan.presented', // one-shot "open the plan tab"; a replay would re-open a closed tab
  ]

  test('every live-only frame reads as live-only', () => {
    for (const type of EXPECTED_LIVE_ONLY) expect(isLiveOnlyEvent(type)).toBe(true)
  })

  test('replayable frames must NEVER be live-only (else reconnect loses state)', () => {
    // The full snapshot is the baseline a reconnecting client rides — it is replayable.
    for (const type of [
      'message.updated',
      'message.created',
      'run.started',
      'run.completed',
      'terminal.finished', // absent from live snapshots after exit; replay settles the missed boundary
      // A mini app→UI command is an ordered state change, so it must survive a reconnect.
      'mini-app.command',
    ] as const) {
      expect(isLiveOnlyEvent(type)).toBe(false)
    }
  })

  test('replays a terminal exit missed during a socket gap', () => {
    const registry = createSessionStreamRegistry()
    registry.publish('u1', 'session-terminal', {
      type: 'terminal.finished',
      sessionId: 'session-terminal',
      terminalId: 'pty-1',
      exitCode: 0,
      command: 'bun test',
    })
    const seen: string[] = []
    const unsubscribe = registry.subscribe(
      'session-terminal',
      (payload) => seen.push(payload.event.type),
      { since: '0' },
    )
    expect(seen).toEqual(['terminal.finished'])
    unsubscribe()
  })
})

describe('mini-app.command replay', () => {
  test('a command published while the client was away is replayed after its cursor', () => {
    const registry = createSessionStreamRegistry()
    const sessionId = 'session-cmd'
    registry.publish('u1', sessionId, {
      type: 'mini-app.command',
      sessionId,
      miniApp: 'fixture-mini-app',
      channel: 'chart',
      payload: { action: 'open', symbol: 'BTC/USDC:USDC' },
      commandId: 'cmd-1',
      seq: 1,
    })

    const replayed: Array<{ type: string; commandId?: string }> = []
    const unsubscribe = registry.subscribe(
      sessionId,
      (p) =>
        replayed.push({
          type: p.event.type,
          commandId: p.event.type === 'mini-app.command' ? p.event.commandId : undefined,
        }),
      { since: '0' },
    )
    expect(replayed).toEqual([{ type: 'mini-app.command', commandId: 'cmd-1' }])
    unsubscribe()
  })

  test('commands are NOT compacted — two back-to-back commands both survive in the ring', () => {
    const registry = createSessionStreamRegistry()
    const sessionId = 'session-cmd2'
    for (const commandId of ['cmd-a', 'cmd-b']) {
      registry.publish('u1', sessionId, {
        type: 'mini-app.command',
        sessionId,
        miniApp: 'sample-mini-app',
        channel: 'chart',
        payload: {},
        commandId,
        seq: 1,
      })
    }
    const seen: string[] = []
    const unsubscribe = registry.subscribe(
      sessionId,
      (p) => {
        if (p.event.type === 'mini-app.command') seen.push(p.event.commandId)
      },
      { since: '0' },
    )
    expect(seen).toEqual(['cmd-a', 'cmd-b'])
    unsubscribe()
  })
})

describe('createSessionStreamRegistry', () => {
  const userId = 'u1'

  test('replays buffered events after a cursor', () => {
    const registry = createSessionStreamRegistry()
    const sessionId = 'session-1'
    const events: Array<{ id: string; type: string }> = []

    registry.publish(userId, sessionId, {
      type: 'run.started',
      sessionId,
      messageId: 'm1',
    })
    registry.publish(userId, sessionId, {
      type: 'run.completed',
      sessionId,
      messageId: 'm1',
    })

    const unsubscribe = registry.subscribe(
      sessionId,
      (payload) => {
        events.push({ id: payload.id, type: payload.event.type })
      },
      { since: '1' },
    )

    expect(events).toEqual([{ id: '2', type: 'run.completed' }])
    unsubscribe()
  })

  test('a throwing subscriber neither starves peers nor propagates into publish', () => {
    // Crumple-zone guard: publish is called from agent-run hot paths (e.g.
    // executeRun's `run.started`) that sit BETWEEN activeRuns.set and the run's
    // try/finally — a subscriber throw that propagated out of publish would wedge
    // the session 'running' forever. Isolation must hold across the fan-out AND the
    // global firehose, and a failing target must not rob the others of the frame.
    const registry = createSessionStreamRegistry()
    const sessionId = 's'
    const perSessionSeen: string[] = []
    const firehoseSeen: string[] = []

    registry.subscribe(sessionId, () => {
      throw new Error('broken socket A')
    })
    registry.subscribe(sessionId, (p) => perSessionSeen.push(p.event.type))
    registry.subscribeAll(userId, () => {
      throw new Error('broken firehose B')
    })
    registry.subscribeAll(userId, (p) => firehoseSeen.push(p.event.type))

    // Publish must not throw despite two throwing subscribers…
    expect(() =>
      registry.publish(userId, sessionId, {
        type: 'run.started',
        sessionId,
        messageId: 'm1',
      }),
    ).not.toThrow()
    // …and the healthy peers on BOTH channels still received the frame.
    expect(perSessionSeen).toEqual(['run.started'])
    expect(firehoseSeen).toEqual(['run.started'])

    // Same isolation on the REPLAY path (a throwing subscriber added with a cursor).
    const replayed: string[] = []
    expect(() =>
      registry.subscribeAll(
        userId,
        (p) => {
          replayed.push(p.event.type)
          throw new Error('throws during replay')
        },
        { since: '0' },
      ),
    ).not.toThrow()
    expect(replayed).toEqual(['run.started'])
  })

  test('subscribeAll multiplexes every session and tags the routing key', () => {
    const registry = createSessionStreamRegistry()
    const seen: Array<{ sessionId: string; type: string }> = []

    const unsubscribe = registry.subscribeAll(userId, (payload) => {
      seen.push({ sessionId: payload.sessionId, type: payload.event.type })
    })

    registry.publish(userId, 'a', {
      type: 'run.started',
      sessionId: 'a',
      messageId: 'm1',
    })
    registry.publish(userId, 'b', {
      type: 'run.started',
      sessionId: 'b',
      messageId: 'm2',
    })

    expect(seen).toEqual([
      { sessionId: 'a', type: 'run.started' },
      { sessionId: 'b', type: 'run.started' },
    ])
    unsubscribe()
  })

  test('subscribeAll replays across sessions from a single global cursor', () => {
    const registry = createSessionStreamRegistry()
    registry.publish(userId, 'a', {
      type: 'run.started',
      sessionId: 'a',
      messageId: 'm1',
    })
    registry.publish(userId, 'b', {
      type: 'run.started',
      sessionId: 'b',
      messageId: 'm2',
    })
    registry.publish(userId, 'a', {
      type: 'run.completed',
      sessionId: 'a',
      messageId: 'm1',
    })

    const replayed: Array<{ id: string; sessionId: string }> = []
    const unsubscribe = registry.subscribeAll(
      userId,
      (payload) => {
        replayed.push({ id: payload.id, sessionId: payload.sessionId })
      },
      { since: '1' },
    )

    expect(replayed).toEqual([
      { id: '2', sessionId: 'b' },
      { id: '3', sessionId: 'a' },
    ])
    unsubscribe()
  })

  test('subscribeAll compacts stale message.updated snapshots in the global ring', () => {
    const registry = createSessionStreamRegistry()
    const message = (text: string) => ({
      id: 'msg-1',
      role: 'assistant' as const,
      content: text,
    })
    // Three snapshots of the SAME message — only the latest should survive replay.
    registry.publish(userId, 'a', {
      type: 'message.updated',
      sessionId: 'a',
      message: message('one'),
    } as never)
    registry.publish(userId, 'a', {
      type: 'message.updated',
      sessionId: 'a',
      message: message('two'),
    } as never)
    registry.publish(userId, 'a', {
      type: 'message.updated',
      sessionId: 'a',
      message: message('three'),
    } as never)

    const replayed: Array<{ id: string }> = []
    const unsubscribe = registry.subscribeAll(
      userId,
      (payload) => {
        replayed.push({ id: payload.id })
      },
      { since: '0' },
    )

    expect(replayed).toEqual([{ id: '3' }])
    unsubscribe()
  })

  test('encodes an event at most once, and not at all when nobody reads it', () => {
    const registry = createSessionStreamRegistry()
    let encodes = 0
    const event = (text: string) =>
      ({
        type: 'message.delta',
        sessionId: 'a',
        messageId: 'm',
        textAppend: text,
        toJSON() {
          encodes += 1
          return { type: 'message.delta', textAppend: text }
        },
      }) as never
    registry.publish(userId, 'a', event('unwatched'))
    expect(encodes).toBe(0)

    const frames: string[] = []
    registry.subscribe('a', (envelope) => frames.push(envelope.data))
    registry.subscribeAll(userId, (envelope) => frames.push(envelope.data))
    registry.publish(userId, 'a', event('watched'))
    expect(encodes).toBe(1)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toBe(frames[1])
  })

  test('non-replayable events reach the firehose live but never replay', () => {
    const registry = createSessionStreamRegistry()
    const live: string[] = []
    const unsubscribeLive = registry.subscribeAll(userId, (payload) => {
      live.push(payload.event.type)
    })

    registry.publish(userId, 'a', {
      type: 'child_session.activity',
      parentSessionId: 'a',
      sessionId: 'a-child',
      activity: 'reading files',
    } as never)
    expect(live).toEqual(['child_session.activity'])
    unsubscribeLive()

    const replayed: string[] = []
    const unsubscribe = registry.subscribeAll(
      userId,
      (payload) => {
        replayed.push(payload.event.type)
      },
      { since: '0' },
    )
    expect(replayed).toEqual([])
    unsubscribe()
  })

  test('compacts session_timing.updated per session, not by bare type', () => {
    const registry = createSessionStreamRegistry()
    const timing = (sessionId: string) =>
      ({ type: 'session_timing.updated', sessionId, timing: {} }) as never
    registry.publish(userId, 'a', timing('a'))
    registry.publish(userId, 'b', timing('b'))
    // A newer snapshot for "a" must drop the stale "a" entry but keep "b"'s.
    registry.publish(userId, 'a', timing('a'))

    const replayed: Array<{ id: string; sessionId: string }> = []
    const unsubscribe = registry.subscribeAll(
      userId,
      (payload) => {
        replayed.push({ id: payload.id, sessionId: payload.sessionId })
      },
      { since: '0' },
    )
    expect(replayed).toEqual([
      { id: '2', sessionId: 'b' },
      { id: '3', sessionId: 'a' },
    ])
    unsubscribe()
  })

  test('keeps one poke per set of topics: the newest covers every older one', () => {
    const registry = createSessionStreamRegistry()
    const poke = (resources: string[]) => ({ type: 'resources.changed', resources }) as never
    registry.publish(userId, '', poke(['local-models']))
    registry.publish(userId, '', poke(['semantic']))
    registry.publish(userId, '', poke(['local-models']))
    registry.publish(userId, '', poke(['vault', 'providers']))
    registry.publish(userId, '', poke(['providers', 'vault']))

    const replayed: string[] = []
    const unsubscribe = registry.subscribeAll(
      userId,
      (payload) => {
        replayed.push(payload.id)
      },
      { since: '0' },
    )
    expect(replayed).toEqual(['2', '3', '5'])
    unsubscribe()
  })

  // The early-out every transient publisher (`child_session.activity`) reads. It must answer
  // "is anyone positioned to RENDER this session", not the old "is this user connected at all" —
  // the latter is true whenever a tab is open, which is how 782 unattended sub-agents each ended
  // up serializing and fanning a frame that every scoped connection then discarded.
  test('hasWatchers answers per SESSION, not per connected user', () => {
    const registry = createSessionStreamRegistry()
    expect(registry.hasWatchers('u1', 'open')).toBe(false)

    const watching = new Set(['open'])
    const unsubscribe = registry.subscribeScoped('u1', () => {}, { watching })
    expect(registry.hasWatchers('u1', 'open')).toBe(true)
    // Connected, but not watching this one — the whole point.
    expect(registry.hasWatchers('u1', 'background')).toBe(false)
    // Another user's socket never counts.
    expect(registry.hasWatchers('u2', 'open')).toBe(false)

    // The live set is the source of truth: mutating it moves the answer with no re-subscribe.
    watching.add('background')
    expect(registry.hasWatchers('u1', 'background')).toBe(true)

    unsubscribe()
    expect(registry.hasWatchers('u1', 'open')).toBe(false)
  })

  test('a per-session subscriber counts as a watcher even with no firehose', () => {
    const registry = createSessionStreamRegistry()
    const unsubscribe = registry.subscribe('s', () => {})
    expect(registry.hasWatchers('u1', 's')).toBe(true)
    unsubscribe()
    expect(registry.hasWatchers('u1', 's')).toBe(false)
  })

  test('an UNSCOPED firehose watches everything (subscribeAll keeps its old meaning)', () => {
    const registry = createSessionStreamRegistry()
    const unsubscribe = registry.subscribeAll('u1', () => {})
    expect(registry.hasWatchers('u1', 'anything')).toBe(true)
    unsubscribe()
  })

  // The EXACTLY-ONCE-PER-CURSOR contract the firehose transport (realtime/ws.ts)
  // and the client reducers silently depend on. A WS reconnect re-subscribes with
  // `since=<lastSequence>`; a replayable frame must reach that subscriber at most once,
  // or a non-idempotent reducer (hook.notice append) double-counts.
  describe('exactly-once per cursor (WS reconnect boundary)', () => {
    const started = (sessionId: string) =>
      ({ type: 'run.started', sessionId, messageId: 'm' }) as AgentStreamEvent

    test('replay(>since) and the subsequent live fan are disjoint — no frame twice, none skipped', () => {
      const registry = createSessionStreamRegistry()
      for (let i = 0; i < 5; i++) registry.publish(userId, 's', started('s')) // ids 1..5

      const delivered: string[] = []
      // Client saw through id 3, reconnects at the cursor boundary.
      const unsubscribe = registry.subscribeAll(userId, (e) => delivered.push(e.id), { since: '3' })
      for (let i = 0; i < 3; i++) registry.publish(userId, 's', started('s')) // live 6..8

      // replay {4,5} ∪ live {6,7,8}, each exactly once, in order.
      expect(delivered).toEqual(['4', '5', '6', '7', '8'])
      expect(new Set(delivered).size).toBe(delivered.length)
      unsubscribe()
    })

    test('a frame at the cursor (id === since) is NOT re-delivered', () => {
      const registry = createSessionStreamRegistry()
      registry.publish(userId, 's', started('s')) // id 1
      const delivered: string[] = []
      const unsubscribe = registry.subscribeAll(userId, (e) => delivered.push(e.id), {
        since: '1',
      })
      expect(delivered).toEqual([]) // id 1 already seen — never replayed
      unsubscribe()
    })

    // Guards the ring SNAPSHOT in replayGlobal / subscribe: without it, a subscriber
    // that re-enters publish() during replay mutates the array mid-iteration, so the
    // new envelope is BOTH fanned live and re-visited by the replay loop → delivered
    // twice. This is the exact fragility the exactly-once contract must survive.
    test('a re-entrant publish during firehose replay is NOT double-delivered', () => {
      const registry = createSessionStreamRegistry()
      for (let i = 0; i < 3; i++) registry.publish(userId, 's', started('s')) // ids 1..3

      const delivered: string[] = []
      let reentered = false
      const unsubscribe = registry.subscribeAll(
        userId,
        (e) => {
          delivered.push(e.id)
          if (!reentered) {
            reentered = true
            registry.publish(userId, 's', started('s')) // id 4, mid-replay
          }
        },
        { since: '0' },
      )

      const counts = new Map<string, number>()
      for (const id of delivered) counts.set(id, (counts.get(id) ?? 0) + 1)
      for (const [, n] of counts) expect(n).toBe(1) // every frame exactly once
      expect(counts.get('4')).toBe(1) // the re-entrant frame arrives once
      unsubscribe()
    })

    test('a re-entrant publish during per-session replay is NOT double-delivered', () => {
      const registry = createSessionStreamRegistry()
      for (let i = 0; i < 3; i++) registry.publish(userId, 's', started('s')) // ids 1..3

      const delivered: string[] = []
      let reentered = false
      const unsubscribe = registry.subscribe(
        's',
        (e) => {
          delivered.push(e.id)
          if (!reentered) {
            reentered = true
            registry.publish(userId, 's', started('s')) // id 4, mid-replay
          }
        },
        { since: '0' },
      )

      const counts = new Map<string, number>()
      for (const id of delivered) counts.set(id, (counts.get(id) ?? 0) + 1)
      for (const [, n] of counts) expect(n).toBe(1)
      expect(counts.get('4')).toBe(1)
      unsubscribe()
    })
  })

  test('subscribeAll isolates multiplexed replay and live events per user', () => {
    const registry = createSessionStreamRegistry()
    registry.publish('u1', 'a', {
      type: 'run.started',
      sessionId: 'a',
      messageId: 'm1',
    })
    registry.publish('u2', 'b', {
      type: 'run.started',
      sessionId: 'b',
      messageId: 'm2',
    })

    const replayed: Array<{ id: string; sessionId: string }> = []
    const unsubscribe = registry.subscribeAll(
      'u1',
      (payload) => {
        replayed.push({ id: payload.id, sessionId: payload.sessionId })
      },
      { since: '0' },
    )

    registry.publish('u2', 'c', {
      type: 'run.completed',
      sessionId: 'c',
      messageId: 'm3',
    })
    registry.publish('u1', 'd', {
      type: 'run.completed',
      sessionId: 'd',
      messageId: 'm4',
    })

    expect(replayed).toEqual([
      { id: '1', sessionId: 'a' },
      { id: '4', sessionId: 'd' },
    ])
    unsubscribe()
  })
})

describe('resources.changed replay (the mini-app-toggle poke)', () => {
  // It carries no state, so `live-only` looked right. But it is the ONLY signal that
  // refreshes the client's mini app contribution set, and that set is NOT session state —
  // so "a reconnecting client reconciles from the DB anyway" never covered it. Its old
  // rationale ("refetches on mount anyway") conflated a socket reconnect with a MOUNT:
  // the page stays up, the store keeps its snapshot, and nothing refetches. Dropped, the
  // rail/palette sat on a stale mini app set until the next toggle or a reload.
  test('a toggle published while the firehose was away is replayed on reconnect', () => {
    const registry = createSessionStreamRegistry()
    registry.publish('u1', '', { type: 'resources.changed', resources: ['capabilities'] })

    const replayed: string[] = []
    const unsubscribe = registry.subscribeAll('u1', (p) => replayed.push(p.event.type), {
      since: '0',
    })

    expect(replayed).toEqual(['resources.changed'])
    unsubscribe()
  })

  test('it fans to a LIVE firehose too — replay must not cost the live delivery', () => {
    const registry = createSessionStreamRegistry()
    const seen: string[] = []
    const unsubscribe = registry.subscribeAll('u1', (p) => seen.push(p.event.type))
    registry.publish('u1', '', { type: 'resources.changed', resources: ['capabilities'] })

    expect(seen).toEqual(['resources.changed'])
    unsubscribe()
  })

  test("another user's firehose never sees it — the poke is per-user", () => {
    const registry = createSessionStreamRegistry()
    registry.publish('u1', '', { type: 'resources.changed', resources: ['capabilities'] })

    const seen: string[] = []
    const unsubscribe = registry.subscribeAll('u2', (p) => seen.push(p.event.type), { since: '0' })

    expect(seen).toEqual([])
    unsubscribe()
  })
})

/**
 * The SCOPED firehose — what a browser actually rides.
 *
 * The unscoped firehose was the root of the incident this covers: one session spawned 782
 * concurrent sub-agent sessions and the tab received every frame of all of them. A scoped
 * connection takes the full stream only for the publish keys it DECLARED, plus the narrow roster
 * class every client must act on regardless (see the `DeliveryScope` note in the registry).
 */
describe('subscribeScoped', () => {
  const userId = 'u1'
  const delta = (sessionId: string) =>
    ({ type: 'message.delta', sessionId, messageId: 'm', textAppend: 'x' }) as AgentStreamEvent
  const snapshot = (sessionId: string) =>
    ({ type: 'message.updated', sessionId, message: { id: 'm' } }) as unknown as AgentStreamEvent
  const started = (sessionId: string) =>
    ({ type: 'run.started', sessionId, messageId: 'm' }) as AgentStreamEvent
  const completed = (sessionId: string) =>
    ({ type: 'run.completed', sessionId, messageId: 'm' }) as AgentStreamEvent
  const activity = (parentSessionId: string, childId: string) =>
    ({
      type: 'child_session.activity',
      parentSessionId,
      sessionId: childId,
      activity: 'reading files',
    }) as AgentStreamEvent

  test('a WATCHED session delivers everything, exactly as the unscoped firehose would', () => {
    const registry = createSessionStreamRegistry()
    const seen: string[] = []
    const unsubscribe = registry.subscribeScoped(userId, (p) => seen.push(p.event.type), {
      watching: new Set(['open']),
    })

    registry.publish(userId, 'open', started('open'))
    registry.publish(userId, 'open', delta('open'))
    registry.publish(userId, 'open', snapshot('open'))
    registry.publish(userId, 'open', activity('open', 'open-child'))
    registry.publish(userId, 'open', completed('open'))

    expect(seen).toEqual([
      'run.started',
      'message.delta',
      'message.updated',
      'child_session.activity',
      'run.completed',
    ])
    unsubscribe()
  })

  test('an UNWATCHED session delivers the roster class and nothing per-token', () => {
    const registry = createSessionStreamRegistry()
    const seen: string[] = []
    const unsubscribe = registry.subscribeScoped(userId, (p) => seen.push(p.event.type), {
      watching: new Set(['open']),
    })

    // A background sub-agent, exactly as one of the 782 behaved.
    registry.publish(userId, 'background', started('background'))
    registry.publish(userId, 'background', delta('background'))
    registry.publish(userId, 'background', snapshot('background'))
    registry.publish(userId, 'background', activity('background', 'bg-child'))
    registry.publish(userId, 'background', completed('background'))

    // The roster rows and the terminal frames the notification runtime needs — no deltas,
    // no snapshots, no activity ticks.
    expect(seen).toEqual(['run.started', 'run.completed'])
    unsubscribe()
  })

  test('an EMPTY watched set is roster-only, never a wildcard', () => {
    const registry = createSessionStreamRegistry()
    const seen: string[] = []
    const unsubscribe = registry.subscribeScoped(userId, (p) => seen.push(p.event.type), {
      watching: new Set(),
    })

    registry.publish(userId, 's', delta('s'))
    registry.publish(userId, 's', started('s'))

    expect(seen).toEqual(['run.started'])
    unsubscribe()
  })

  // A run that BLOCKS on the client must never be scoped away: the HITL inbox is global by
  // design, and an awaited mini app/preview command has no other way to be settled. A background
  // sub-agent whose approval prompt was filtered would hang with nothing on screen to unblock it.
  test('blocking round-trips and notification producers reach an unwatched session', () => {
    const registry = createSessionStreamRegistry()
    const seen: string[] = []
    const unsubscribe = registry.subscribeScoped(userId, (p) => seen.push(p.event.type), {
      watching: new Set(['open']),
    })

    registry.publish(userId, 'background', {
      type: 'hitl.requested',
      sessionId: 'background',
    } as unknown as AgentStreamEvent)
    registry.publish(userId, 'background', {
      type: 'mini-app.command',
      sessionId: 'background',
    } as unknown as AgentStreamEvent)
    registry.publish(userId, 'background', {
      type: 'terminal.finished',
      sessionId: 'background',
    } as unknown as AgentStreamEvent)
    registry.publish(userId, 'background', {
      type: 'child_session.updated',
      sessionId: 'background',
    } as unknown as AgentStreamEvent)
    // …and the mini-app-set poke, which has an EMPTY publish key no watched set could ever match.
    registry.publish(userId, '', { type: 'resources.changed', resources: ['capabilities'] })

    expect(seen).toEqual([
      'hitl.requested',
      'mini-app.command',
      'terminal.finished',
      'child_session.updated',
      'resources.changed',
    ])
    unsubscribe()
  })

  // The set is held BY REFERENCE, so the transport re-scopes a live socket by mutating it —
  // never by re-subscribing, which would replay the ring and re-deliver every roster frame in it.
  test('mutating the watched set re-scopes the LIVE stream with no re-subscribe', () => {
    const registry = createSessionStreamRegistry()
    const watching = new Set<string>()
    const seen: string[] = []
    const unsubscribe = registry.subscribeScoped(userId, (p) => seen.push(p.event.type), {
      watching,
    })

    registry.publish(userId, 's', delta('s'))
    expect(seen).toEqual([])

    watching.add('s')
    registry.publish(userId, 's', delta('s'))
    expect(seen).toEqual(['message.delta'])

    watching.delete('s')
    registry.publish(userId, 's', delta('s'))
    expect(seen).toEqual(['message.delta'])
    unsubscribe()
  })

  // The exactly-once contract is the SAME contract: the scope decision is a per-frame predicate
  // inside the shared replay/fan path, not a second delivery path. Replay must therefore stay
  // disjoint from the live fan for a scoped subscriber too.
  test('replay is scoped, and replay ∪ live is still exactly-once', () => {
    const registry = createSessionStreamRegistry()
    registry.publish(userId, 'open', started('open')) // id 1
    registry.publish(userId, 'open', snapshot('open')) // id 2 — watched class
    registry.publish(userId, 'background', started('background')) // id 3 — roster
    registry.publish(userId, 'background', snapshot('background')) // id 4 — filtered

    const delivered: string[] = []
    const unsubscribe = registry.subscribeScoped(userId, (p) => delivered.push(p.id), {
      since: '0',
      watching: new Set(['open']),
    })
    registry.publish(userId, 'background', snapshot('background')) // id 5 — filtered live
    registry.publish(userId, 'open', snapshot('open')) // id 6 — live, watched

    expect(delivered).toEqual(['1', '2', '3', '6'])
    expect(new Set(delivered).size).toBe(delivered.length)
    unsubscribe()
  })

  test('a re-entrant publish during SCOPED replay is not double-delivered', () => {
    const registry = createSessionStreamRegistry()
    for (let i = 0; i < 3; i++) registry.publish(userId, 'open', started('open')) // ids 1..3

    const delivered: string[] = []
    let reentered = false
    const unsubscribe = registry.subscribeScoped(
      userId,
      (e) => {
        delivered.push(e.id)
        if (!reentered) {
          reentered = true
          registry.publish(userId, 'open', started('open')) // id 4, mid-replay
        }
      },
      { since: '0', watching: new Set(['open']) },
    )

    const counts = new Map<string, number>()
    for (const id of delivered) counts.set(id, (counts.get(id) ?? 0) + 1)
    for (const [, n] of counts) expect(n).toBe(1)
    expect(counts.get('4')).toBe(1)
    unsubscribe()
  })

  test('the ring is unaffected: an unscoped reconnect still replays what a scoped one skipped', () => {
    const registry = createSessionStreamRegistry()
    const scoped = registry.subscribeScoped(userId, () => {}, { watching: new Set() })
    registry.publish(userId, 's', snapshot('s')) // id 1 — filtered for `scoped`, still buffered
    scoped()

    const replayed: string[] = []
    const unsubscribe = registry.subscribeAll(userId, (p) => replayed.push(p.id), { since: '0' })
    expect(replayed).toEqual(['1'])
    unsubscribe()
  })
})

/**
 * The roster class is derived from the SAME table as the replay tier. Each named frame must bypass
 * the watch gate: a frame quietly moved to `watched` goes unreachable for every session the user is
 * not looking at.
 */
describe('requiresWatchedSession', () => {
  const EXPECTED_ROSTER: AgentStreamEvent['type'][] = [
    'session.updated', // the sidebar row itself
    'session.deleted', // committed removal of the entire conversation tree
    'resources.changed', // shared read models outside the conversation body
    'child_session.updated', // the sub-session roster + a notification producer
    'run.started', // the running spinner
    'run.completed', // notification: an unattended run finished
    'run.failed',
    'hitl.requested', // the inbox is global; a filtered prompt hangs the run
    'hitl.resolved',
    'user.mentioned', // a member asked the person directly; the room it happened in is one
    //                   they were not watching, which is the whole point of the frame
    'plan.updated', // the sidebar marks a session whose plan waits for review
    'session_resume.updated', // the root's unfinished work, shown in a delegated child's composer too
    'plan.presented', // opens the plan tab even while the person watches a delegated child
    'attention.updated', // the user's whole "waiting on you" set — not session state at all
    'terminal.finished', // notification + settles a wait missed while away
    'mini-app.command', // awaited round-trip — only the client can settle it
    'preview.command', // same, for the `browser` tool
    'preview.updated', // background hosts mount without selecting the conversation
    'preview.closed', // background hosts release without selecting the conversation
  ]

  test('requiresWatchedSession is the exact complement', () => {
    for (const type of EXPECTED_ROSTER) expect(requiresWatchedSession(type)).toBe(false)
    for (const type of ['message.delta', 'message.updated', 'child_session.activity'] as const) {
      expect(requiresWatchedSession(type)).toBe(true)
    }
  })
})

describe('replay gap', () => {
  const publishRuns = (registry: ReturnType<typeof createSessionStreamRegistry>, count: number) => {
    for (let i = 0; i < count; i++)
      registry.publish('u1', `s${i}`, { type: 'run.started', sessionId: `s${i}`, messageId: 'm' })
  }

  test('a cursor the ring still covers replays without a gap', () => {
    const registry = createSessionStreamRegistry()
    publishRuns(registry, 3)
    const gaps: string[] = []
    const ids: string[] = []
    registry.subscribeScoped('u1', (frame) => void ids.push(frame.id), {
      since: '1',
      watching: new Set(),
      onGap: (through) => void gaps.push(through),
    })
    expect(gaps).toEqual([])
    expect(ids).toEqual(['2', '3'])
  })

  test('a cursor older than the trimmed ring reports the gap before the replay', () => {
    const registry = createSessionStreamRegistry()
    publishRuns(registry, 2005)
    const order: string[] = []
    registry.subscribeScoped('u1', (frame) => void order.push(frame.id), {
      since: '1',
      watching: new Set(),
      onGap: (through) => void order.push(`gap:${through}`),
    })
    expect(order[0]).toBe('gap:5')
    expect(order[1]).toBe('6')
    expect(order).toHaveLength(2001)
  })
})
