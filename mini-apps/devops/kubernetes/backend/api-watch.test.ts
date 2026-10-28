import { describe, expect, test } from 'bun:test'

import { ApiPodWatchRegistry, watchRestartDelay, type CreatePodInformer } from './api-watch'

/** An informer factory whose informers only count starts and stops, released by hand. */
function gatedInformers() {
  const created: Array<{ started: number; stopped: number }> = []
  const gates: Array<() => void> = []
  const create: CreatePodInformer = () =>
    new Promise((resolve) => {
      gates.push(() => {
        const informer = { started: 0, stopped: 0 }
        created.push(informer)
        resolve({
          on: () => {},
          off: () => {},
          start: async () => void informer.started++,
          stop: async () => void informer.stopped++,
          list: () => [],
          get: () => undefined,
        } as never)
      })
    })
  return { create, created, gates }
}

describe('Kubernetes pod watch start', () => {
  test('a second subscriber while the first start is pending does not start a second informer', async () => {
    const { create, created, gates } = gatedInformers()
    const registry = new ApiPodWatchRegistry(5_000, create)
    const sub = { onFrame: () => {} }
    registry.subscribe('ctx', 'default', sub)
    registry.subscribe('ctx', 'default', { onFrame: () => {} })
    expect(gates).toHaveLength(1)
    gates[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(created).toHaveLength(1)
    await registry.stopAll()
    expect(created[0]!.stopped).toBe(1)
  })

  test('a watch stopped while starting never parks a running informer on the dead entry', async () => {
    const { create, created, gates } = gatedInformers()
    const registry = new ApiPodWatchRegistry(1, create)
    const unsubscribe = registry.subscribe('ctx', 'default', { onFrame: () => {} })
    unsubscribe()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) // the idle stop runs while the cluster is still answering
    gates[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(created[0]!.started).toBe(0)
  })
})

describe('Kubernetes watch reconnect pacing', () => {
  test('backs off exponentially and caps a long outage', () => {
    expect(watchRestartDelay(0)).toBe(1_500)
    expect(watchRestartDelay(1)).toBe(3_000)
    expect(watchRestartDelay(2)).toBe(6_000)
    expect(watchRestartDelay(3)).toBe(12_000)
    expect(watchRestartDelay(20)).toBe(30_000)
  })

  test('normalizes an invalid negative attempt to the first delay', () => {
    expect(watchRestartDelay(-10)).toBe(1_500)
  })
})
