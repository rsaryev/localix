import { describe, expect, test } from 'bun:test'
import { createDockerRefreshCoordinator, type DockerRefreshScope } from './dockerRefreshCoordinator'

function deferred() {
  let resolve!: () => void
  let reject!: (cause: Error) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('Docker refresh coordinator', () => {
  test('coalesces equal and weaker requests into the active read', async () => {
    const reads: Array<{ scope: DockerRefreshScope; request: ReturnType<typeof deferred> }> = []
    const coordinator = createDockerRefreshCoordinator((scope) => {
      const request = deferred()
      reads.push({ scope, request })
      return request.promise
    })

    const full = coordinator.request('all')
    const joinedFull = coordinator.request('all')
    const joinedContainers = coordinator.request('containers')
    await flush()

    expect(joinedFull).toBe(full)
    expect(joinedContainers).toBe(full)
    expect(reads.map((read) => read.scope)).toEqual(['all'])

    reads[0]!.request.resolve()
    await full
  })

  test('queues exactly one full refresh behind a container-only poll', async () => {
    const reads: Array<{ scope: DockerRefreshScope; request: ReturnType<typeof deferred> }> = []
    const coordinator = createDockerRefreshCoordinator((scope) => {
      const request = deferred()
      reads.push({ scope, request })
      return request.promise
    })

    const containers = coordinator.request('containers')
    await flush()
    const full = coordinator.request('all')
    const joinedFull = coordinator.request('all')

    expect(joinedFull).toBe(full)
    expect(reads.map((read) => read.scope)).toEqual(['containers'])

    reads[0]!.request.resolve()
    await flush()
    expect(reads.map((read) => read.scope)).toEqual(['containers', 'all'])

    reads[1]!.request.resolve()
    await Promise.all([containers, full])

    const laterFull = coordinator.request('all')
    await flush()
    expect(reads.map((read) => read.scope)).toEqual(['containers', 'all', 'all'])
    reads[2]!.request.resolve()
    await laterFull
  })

  test('still performs the queued full refresh after a failed poll', async () => {
    const reads: Array<{ scope: DockerRefreshScope; request: ReturnType<typeof deferred> }> = []
    const coordinator = createDockerRefreshCoordinator((scope) => {
      const request = deferred()
      reads.push({ scope, request })
      return request.promise
    })

    const containers = coordinator.request('containers')
    void containers.catch(() => {})
    await flush()
    const full = coordinator.request('all')
    reads[0]!.request.reject(new Error('poll failed'))
    await flush()

    expect(reads.map((read) => read.scope)).toEqual(['containers', 'all'])
    reads[1]!.request.resolve()
    await full
  })
})
