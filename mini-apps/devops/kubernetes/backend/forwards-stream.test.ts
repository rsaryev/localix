import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { createWsFrameConnection, createWsFrameRegistry } from '@localixai/mini-app-sdk/backend'

import { ApiPortForwardRegistry } from './api-port-forward'
import type { PortForward } from './contracts'
import { createPortForwardsWsFrame } from './index'

function forward(id: string, owner = ''): PortForward {
  return {
    id,
    namespace: 'default',
    pod: 'web',
    localPort: 8080,
    podPort: 80,
    context: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    owner,
  }
}

/** A registry holding live entries without a cluster: the listener never listens, so closes at once. */
function registryWith(...forwards: PortForward[]): ApiPortForwardRegistry {
  const registry = new ApiPortForwardRegistry()
  const entries = (registry as unknown as { forwards: Map<string, unknown> }).forwards
  for (const meta of forwards) {
    entries.set(meta.id, { meta, server: createServer(), sockets: new Set(), tunnels: new Set() })
  }
  return registry
}

describe('port-forward changes', () => {
  test('a stop announces the change once the forward is off the list', async () => {
    const registry = registryWith(forward('a'), forward('b'))
    const lists: string[][] = []
    registry.onChange(() => lists.push(registry.list().map((meta) => meta.id)))
    await registry.stop('a')
    expect(lists).toEqual([['b']])
  })

  test('closing a tab announces each forward it owned, and nothing for an empty owner', async () => {
    const registry = registryWith(forward('a', 'tab'), forward('b', 'tab'), forward('c'))
    let changes = 0
    const off = registry.onChange(() => (changes += 1))
    await registry.stopByOwner('nobody')
    expect(changes).toBe(0)
    await registry.stopByOwner('tab')
    expect(changes).toBe(2)
    off()
    await registry.stopAll()
    expect(changes).toBe(2)
  })

  test('every following socket hears an f-tagged change frame', async () => {
    const registry = registryWith(forward('a'))
    const frames = createWsFrameRegistry()
    expect(
      frames.register(
        createPortForwardsWsFrame({
          watchPortForwards: (listener) => registry.onChange(listener),
        }),
      ),
    ).toEqual({ status: 'registered' })
    const sent: string[][] = [[], []]
    const sockets = sent.map((list) =>
      createWsFrameConnection(frames, (frame) => list.push(frame), { userId: 'u' }),
    )
    for (const socket of sockets) socket.subscribe('devops:k8s.forwards.subscribe', {})

    await registry.stop('a')
    for (const list of sent) expect(list).toEqual([`f\n${JSON.stringify({ kind: 'changed' })}`])
    for (const socket of sockets) socket.teardown()
  })
})
