import { describe, expect, test } from 'bun:test'

import { createShutdownSteps, type ShutdownStepFailure } from './shutdown-steps'

describe('shutdown steps', () => {
  test('a throwing or overrunning step is reported and the teardown goes on', async () => {
    const reported: ShutdownStepFailure[] = []
    const steps = createShutdownSteps(1_000, (failure) => reported.push(failure))
    const ran: string[] = []

    await steps.run('sync throw', () => {
      throw new Error('leaking disposables')
    })
    await steps.run('slow', () => new Promise(() => {}), 20)
    await steps.run('fine', () => void ran.push('fine'))

    expect(ran).toEqual(['fine'])
    expect(reported.map((failure) => failure.step)).toEqual(['sync throw', 'slow'])
    expect(String(reported[1]?.error)).toContain('slow timed out after 20ms')
    expect(steps.failures()).toHaveLength(2)
  })

  test('a reporter that throws does not end the teardown', async () => {
    const steps = createShutdownSteps(1_000, () => {
      throw new Error('log sink closed')
    })
    await steps.run('broken', () => Promise.reject(new Error('boom')))
    expect(steps.failures()).toHaveLength(1)
  })
})
