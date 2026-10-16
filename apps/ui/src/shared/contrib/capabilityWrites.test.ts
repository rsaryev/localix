import { describe, expect, test } from 'bun:test'
import { trackCapabilityWrite, waitForCapabilityWrites } from './capabilityWrites'

describe('capability write barrier', () => {
  test('registers before invoking mutation code so reentrant runs cannot pass through', async () => {
    let observed: Promise<void> | null | undefined
    const mutation = trackCapabilityWrite('project-reentrant', async () => {
      observed = waitForCapabilityWrites('project-reentrant')
    })

    expect(observed).not.toBeNull()
    expect(observed).not.toBeUndefined()
    await mutation
    await observed
    expect(waitForCapabilityWrites('project-reentrant')).toBeNull()
  })

  test('isolates known project scopes and makes an unknown run wait for all', async () => {
    const releases: Array<() => void> = []
    const operation = () =>
      new Promise<void>((resolve) => {
        releases.push(resolve)
      })
    const projectA = trackCapabilityWrite('project-a', operation)
    const projectB = trackCapabilityWrite('project-b', operation)

    expect(waitForCapabilityWrites(null)).toBeNull()
    const onlyA = waitForCapabilityWrites('project-a')
    const all = waitForCapabilityWrites(undefined)
    expect(onlyA).not.toBeNull()
    expect(all).not.toBeNull()

    releases[0]!()
    await projectA
    await onlyA
    let allSettled = false
    void all!.then(() => {
      allSettled = true
    })
    await Promise.resolve()
    expect(allSettled).toBe(false)

    releases[1]!()
    await projectB
    await all
    expect(allSettled).toBe(true)
  })

  test('an unknown-scope mutation blocks every run and cleans up after failure', async () => {
    const mutation = trackCapabilityWrite(undefined, async () => {
      throw new Error('discovery failed')
    })
    const runBarrier = waitForCapabilityWrites('project-a')
    expect(runBarrier).not.toBeNull()

    const [mutationResult, barrierResult] = await Promise.allSettled([mutation, runBarrier!])
    expect(mutationResult.status).toBe('rejected')
    expect(barrierResult.status).toBe('rejected')
    expect(waitForCapabilityWrites('project-a')).toBeNull()
  })
})
