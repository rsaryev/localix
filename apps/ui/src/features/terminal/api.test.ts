import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { resetNotificationsForTests, useNotificationsStore } from '@/shared/lib/notifications/store'
import { closeTerminal } from './api'

/**
 * Closing a terminal tab used to swallow every failure: the tab was gone, the shell (and whatever
 * it ran) was not, and nothing said so. The person closed it, so a refused close is their failure.
 */

const rows = () => useNotificationsStore.getState().entries
let restore: (() => void) | undefined

beforeEach(() => resetNotificationsForTests())
afterEach(() => {
  restore?.()
  restore = undefined
  resetNotificationsForTests()
})

describe('closeTerminal', () => {
  test('a close that never reached the server is said', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    restore = () => fetch.mockRestore()
    await closeTerminal('t1')
    expect(rows()[0]).toMatchObject({ severity: 'error', title: 'Could not close the terminal' })
    expect(rows()[0]?.message).toContain('Its process may still be running.')
  })

  test('a refused close is said too', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    restore = () => fetch.mockRestore()
    await closeTerminal('t1')
    expect(rows()[0]?.title).toBe('Could not close the terminal')
  })

  test('an already-gone terminal is the goal reached, not a failure', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    restore = () => fetch.mockRestore()
    await closeTerminal('t1')
    expect(rows()).toEqual([])
  })
})
