import { describe, expect, test } from 'bun:test'

import { PodSeedCoordinator } from './podSeedCoordinator'

describe('Kubernetes pod seed coordination', () => {
  test('shares one pending request across a reconnect storm', async () => {
    const coordinator = new PodSeedCoordinator()
    let calls = 0
    let resolve!: (value: string) => void
    const task = () => {
      calls += 1
      return new Promise<string>((done) => {
        resolve = done
      })
    }

    const first = coordinator.run(4, 'prod/default/api', task)
    const reconnects = Array.from({ length: 50 }, () =>
      coordinator.run(4, 'prod/default/api', task),
    )

    expect(calls).toBe(1)
    expect(reconnects.every((promise) => promise === first)).toBe(true)
    resolve('ready')
    expect(await first).toBe('ready')
  })

  test('never joins a request from an older target generation', async () => {
    const coordinator = new PodSeedCoordinator()
    const old = coordinator.run(1, 'prod/default/api', async () => 'old')
    const current = coordinator.run(2, 'staging/default/api', async () => 'current')

    expect(current).not.toBe(old)
    expect(await current).toBe('current')
  })

  test('allows a later recovery read after the previous request settles', async () => {
    const coordinator = new PodSeedCoordinator()
    let calls = 0
    const task = async () => ++calls

    expect(await coordinator.run(3, 'prod/default/api', task)).toBe(1)
    await Promise.resolve()
    expect(await coordinator.run(3, 'prod/default/api', task)).toBe(2)
  })
})
