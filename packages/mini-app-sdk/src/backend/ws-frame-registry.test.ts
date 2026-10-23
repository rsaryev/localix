import { describe, expect, it } from 'bun:test'
import {
  createWsFrameConnection,
  createWsFrameRegistry,
  type WsFrameContribution,
} from './ws-frame-registry'

function makeContribution(counters: { starts: number; stops: number }): WsFrameContribution {
  return {
    subscribeCommand: 'x.watch.subscribe',
    unsubscribeCommand: 'x.watch.unsubscribe',
    frameTag: 'x',
    key: (params) => (typeof params.ns === 'string' ? params.ns : ''),
    start: (params, send) => {
      counters.starts++
      send(JSON.stringify({ ns: params.ns }))
      return { ns: params.ns }
    },
    stop: () => {
      counters.stops++
    },
  }
}

/** The identity the host bound from the authenticated socket. */
const SOCKET = { userId: 'u1' }

function setup() {
  const counters = { starts: 0, stops: 0 }
  const registry = createWsFrameRegistry()
  registry.register(makeContribution(counters))
  const frames: string[] = []
  const conn = createWsFrameConnection(registry, (f) => frames.push(f), SOCKET)
  return { counters, conn, frames }
}

describe('createWsFrameRegistry register collisions', () => {
  const contribution = (over: Partial<WsFrameContribution>): WsFrameContribution => ({
    subscribeCommand: 'x.watch.subscribe',
    unsubscribeCommand: 'x.watch.unsubscribe',
    frameTag: 'x',
    start: () => ({}),
    stop: () => {},
    ...over,
  })

  it('accepts the first contribution', () => {
    const registry = createWsFrameRegistry()
    expect(registry.register(contribution({})).status).toBe('registered')
    expect(registry.list()).toHaveLength(1)
  })

  it('rejects a frame tag core sends itself', () => {
    // A contributed stream tagged `n` would be demuxed as Event Center journal changes.
    for (const tag of ['s', 'r', 'n']) {
      expect(createWsFrameRegistry().register(contribution({ frameTag: tag }))).toMatchObject({
        status: 'rejected',
        reason: 'reserved_tag',
        tag,
      })
    }
  })

  it('accepts `k` — core no longer sends board frames, so the tag is free for a mini app', () => {
    // The task board moved into a mini app that streams on `k`; a stale reservation would refuse
    // the one contribution the tag now belongs to.
    expect(createWsFrameRegistry().register(contribution({ frameTag: 'k' })).status).toBe(
      'registered',
    )
  })

  it('rejects a duplicate subscribeCommand loudly instead of silently shadowing', () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({ frameTag: 'a' }))
    // A second contributor declaring the SAME subscribe command is unroutable — the
    // first-match finder would drop its frames. It must be rejected, not silently added.
    const outcome = registry.register(
      contribution({ frameTag: 'b', unsubscribeCommand: 'y.unsub' }),
    )
    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'duplicate_subscribe',
      command: 'x.watch.subscribe',
    })
    // The loser was NOT registered, so the first contributor still owns the command.
    expect(registry.list()).toHaveLength(1)
    expect(registry.findBySubscribe('x.watch.subscribe')?.frameTag).toBe('a')
  })

  it('rejects a duplicate unsubscribeCommand', () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({}))
    const outcome = registry.register(contribution({ subscribeCommand: 'z.sub' }))
    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'duplicate_unsubscribe',
      command: 'x.watch.unsubscribe',
    })
    expect(registry.list()).toHaveLength(1)
  })

  it("rejects a subscribe command that is already another stream's unsubscribe command", () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({}))

    expect(
      registry.register(
        contribution({
          subscribeCommand: 'x.watch.unsubscribe',
          unsubscribeCommand: 'z.unsubscribe',
        }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'duplicate_subscribe',
      command: 'x.watch.unsubscribe',
    })
  })

  it("rejects an unsubscribe command that is already another stream's subscribe command", () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({}))

    expect(
      registry.register(
        contribution({
          subscribeCommand: 'z.subscribe',
          unsubscribeCommand: 'x.watch.subscribe',
        }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'duplicate_unsubscribe',
      command: 'x.watch.subscribe',
    })
  })

  it('rejects a contribution that uses one command for both directions', () => {
    const registry = createWsFrameRegistry()
    expect(
      registry.register(
        contribution({
          subscribeCommand: 'x.toggle',
          unsubscribeCommand: 'x.toggle',
        }),
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'duplicate_unsubscribe',
      command: 'x.toggle',
    })
    expect(registry.list()).toHaveLength(0)
  })

  it('unregister removes by subscribe command and frees it for re-registration', () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({ frameTag: 'a' }))
    registry.unregister('x.watch.subscribe')
    expect(registry.list()).toHaveLength(0)
    expect(registry.findBySubscribe('x.watch.subscribe')).toBeUndefined()
    // Re-enable: the same commands register cleanly again (no phantom collision).
    expect(registry.register(contribution({ frameTag: 'b' })).status).toBe('registered')
    expect(registry.findBySubscribe('x.watch.subscribe')?.frameTag).toBe('b')
  })

  it('unregister of an unknown command is a no-op', () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({}))
    registry.unregister('nope.subscribe')
    expect(registry.list()).toHaveLength(1)
  })

  it('a REJECTED contributor cannot unregister the contribution it lost to', () => {
    // `register` rejects a duplicate subscribe command LOUDLY and keeps the first — but
    // the loser's own record still CARRIES that command, and a disable unregisters every
    // frame the subsystem declared. Removing by command NAME therefore evicted the WINNER:
    // still-enabled mini app, live subsystem and UI tab, but its stream refuses new
    // subscribes with nothing said. Same defect the resource/search registries already
    // fixed ("pass the provider, not its id") and the route mount table checks by identity.
    const registry = createWsFrameRegistry()
    const winner = contribution({ frameTag: 'a' })
    const loser = contribution({ frameTag: 'b', unsubscribeCommand: 'y.unsub' })
    expect(registry.register(winner).status).toBe('registered')
    expect(registry.register(loser).status).toBe('rejected')

    registry.unregister(loser)
    expect(registry.findBySubscribe('x.watch.subscribe')).toBe(winner)
    expect(registry.list()).toHaveLength(1)
  })

  it('the OWNER still unregisters itself — the identity check is not a leak', () => {
    // The reverse direction: if identity over-reaches, a disabled mini app keeps accepting
    // subscribes forever. The registered object is exactly what the owner passes back.
    const registry = createWsFrameRegistry()
    const own = contribution({ frameTag: 'a' })
    registry.register(own)
    registry.unregister(own)
    expect(registry.list()).toHaveLength(0)
    expect(registry.findBySubscribe('x.watch.subscribe')).toBeUndefined()
  })

  it('unregister does not kill a live stream — teardown stays with the connection', () => {
    const counters = { starts: 0, stops: 0 }
    const registry = createWsFrameRegistry()
    registry.register(makeContribution(counters))
    const conn = createWsFrameConnection(registry, () => {}, SOCKET)
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    registry.unregister('x.watch.subscribe')
    // New subscribes are refused…
    expect(conn.subscribe('x.watch.subscribe', { ns: 'b' })).toBe(false)
    // …but the live stream still tears down through the connection.
    conn.teardown()
    expect(counters.stops).toBe(1)
  })

  it('accepts a contribution with fully distinct commands', () => {
    const registry = createWsFrameRegistry()
    registry.register(contribution({}))
    expect(
      registry.register(contribution({ subscribeCommand: 'z.sub', unsubscribeCommand: 'z.unsub' }))
        .status,
    ).toBe('registered')
    expect(registry.list()).toHaveLength(2)
  })
})

describe('createWsFrameConnection', () => {
  it('replaces a stale stream owner on resubscribe after backend reload', () => {
    const registry = createWsFrameRegistry()
    const old = { starts: 0, stops: 0 }
    const next = { starts: 0, stops: 0 }
    const before = makeContribution(old)
    registry.register(before)
    const conn = createWsFrameConnection(registry, () => {}, SOCKET, { maxActiveStreams: 1 })
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    registry.unregister(before)
    registry.register(makeContribution(next))
    expect(conn.subscribe('x.watch.subscribe', { ns: 'a' })).toBe(true)
    expect(old).toEqual({ starts: 1, stops: 1 })
    expect(next.starts).toBe(1)
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'a' })
    expect(next.stops).toBe(1)
    conn.teardown()
    expect(old.stops).toBe(1)
    expect(next.stops).toBe(1)
  })

  it('starts a stream on subscribe and frames pushes with the frame tag', () => {
    const { conn, frames, counters } = setup()
    expect(conn.subscribe('x.watch.subscribe', { ns: 'a' })).toBe(true)
    expect(frames).toEqual(['x\n{"ns":"a"}'])
    expect(counters.starts).toBe(1)
  })

  it('does not own unrecognized commands', () => {
    const { conn } = setup()
    expect(conn.subscribe('nope.subscribe', {})).toBe(false)
    expect(conn.unsubscribe('nope.unsubscribe', {})).toBe(false)
  })

  it('refcounts same-key subscribers: one spawn, stop only when the last leaves', () => {
    const { conn, counters } = setup()
    // Two subscribers over one socket (e.g. sidebar + pod tab, same namespace).
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    expect(counters.starts).toBe(1)
    // First unmount must NOT kill the shared stream…
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'a' })
    expect(counters.stops).toBe(0)
    // …the last one does.
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'a' })
    expect(counters.stops).toBe(1)
  })

  it('keys streams per params — different keys run independent streams', () => {
    const { conn, counters } = setup()
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    conn.subscribe('x.watch.subscribe', { ns: 'b' })
    expect(counters.starts).toBe(2)
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'a' })
    expect(counters.stops).toBe(1)
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'b' })
    expect(counters.stops).toBe(2)
  })

  it('an unbalanced unsubscribe is a no-op (never goes negative)', () => {
    const { conn, counters } = setup()
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'a' })
    expect(counters.stops).toBe(0)
    // A later subscribe still starts fresh and tears down normally.
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    conn.unsubscribe('x.watch.unsubscribe', { ns: 'a' })
    expect(counters.starts).toBe(1)
    expect(counters.stops).toBe(1)
  })

  it('teardown stops every active stream exactly once', () => {
    const { conn, counters } = setup()
    conn.subscribe('x.watch.subscribe', { ns: 'a' })
    conn.subscribe('x.watch.subscribe', { ns: 'a' }) // refcount 2, one handle
    conn.subscribe('x.watch.subscribe', { ns: 'b' })
    conn.teardown()
    expect(counters.stops).toBe(2)
  })

  it('isolates throwing mini app key/start callbacks', () => {
    const registry = createWsFrameRegistry()
    registry.register({
      subscribeCommand: 'bad-key.subscribe',
      unsubscribeCommand: 'bad-key.unsubscribe',
      frameTag: 'x',
      key: () => {
        throw new Error('key failed')
      },
      start: () => ({}),
      stop: () => {},
    })
    registry.register({
      subscribeCommand: 'bad-start.subscribe',
      unsubscribeCommand: 'bad-start.unsubscribe',
      frameTag: 'y',
      start: () => {
        throw new Error('start failed')
      },
      stop: () => {},
    })
    const conn = createWsFrameConnection(registry, () => {}, SOCKET)

    expect(conn.subscribe('bad-key.subscribe', {})).toBe(false)
    expect(conn.unsubscribe('bad-key.unsubscribe', {})).toBe(false)
    expect(conn.subscribe('bad-start.subscribe', {})).toBe(false)
    expect(() => conn.teardown()).not.toThrow()
  })

  it('bounds distinct active handles per socket', () => {
    const { counters, conn } = (() => {
      const counters = { starts: 0, stops: 0 }
      const registry = createWsFrameRegistry()
      registry.register(makeContribution(counters))
      return {
        counters,
        conn: createWsFrameConnection(registry, () => {}, SOCKET, { maxActiveStreams: 1 }),
      }
    })()

    expect(conn.subscribe('x.watch.subscribe', { ns: 'a' })).toBe(true)
    expect(conn.subscribe('x.watch.subscribe', { ns: 'b' })).toBe(false)
    expect(counters.starts).toBe(1)
    conn.teardown()
    expect(counters.stops).toBe(1)
  })

  it('continues teardown after a mini app stop throws', () => {
    const registry = createWsFrameRegistry()
    const stopped: string[] = []
    registry.register({
      subscribeCommand: 'x.subscribe',
      unsubscribeCommand: 'x.unsubscribe',
      frameTag: 'x',
      key: (params) => String(params.id),
      start: (params) => String(params.id),
      stop: (handle) => {
        stopped.push(String(handle))
        if (handle === 'a') throw new Error('stop failed')
      },
    })
    const conn = createWsFrameConnection(registry, () => {}, SOCKET)
    conn.subscribe('x.subscribe', { id: 'a' })
    conn.subscribe('x.subscribe', { id: 'b' })

    expect(() => conn.teardown()).not.toThrow()
    expect(stopped).toEqual(['a', 'b'])
    expect(() => conn.teardown()).not.toThrow()
    expect(stopped).toEqual(['a', 'b'])
  })

  it('rejects invalid connection bounds', () => {
    const registry = createWsFrameRegistry()
    expect(() =>
      createWsFrameConnection(registry, () => {}, SOCKET, { maxActiveStreams: 0 }),
    ).toThrow('positive safe integer')
  })

  // A stream of someone's own data must know whose socket asked. The identity is the one the
  // HOST bound, never a field of the client's params: a contribution that read the user from
  // params would let any socket name any user.
  it('hands start the socket identity the host bound, not one from the params', () => {
    const registry = createWsFrameRegistry()
    const seen: unknown[] = []
    registry.register({
      subscribeCommand: 'own.subscribe',
      unsubscribeCommand: 'own.unsubscribe',
      frameTag: 'o',
      start: (_params, _send, context) => {
        seen.push(context)
        return {}
      },
      stop: () => {},
    })
    const conn = createWsFrameConnection(registry, () => {}, { userId: 'owner' })
    expect(conn.subscribe('own.subscribe', { userId: 'intruder' })).toBe(true)
    expect(seen).toEqual([{ userId: 'owner' }])
  })
})
