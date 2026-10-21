import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'

/**
 * Restart-to-update ended every running turn and background job on one click. Both install
 * surfaces go through `restartToUpdate`, so this pins the one rule: ask first when something
 * would be stopped, and install at once when nothing would.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

let restoreStore: (() => void) | undefined
afterEach(async () => {
  restoreStore?.()
  const { resetConfirmationsForTests } = await import('@/shared/lib/confirmAction')
  resetConfirmationsForTests()
})

async function seedRoster(sessions: Partial<UiSession>[]) {
  const { useChatStore } = await import('./store')
  const original = useChatStore.getState()
  restoreStore = () => useChatStore.setState(original, true)
  const roster = sessions.map(
    (patch, index) =>
      ({
        id: `s-${index}`,
        title: 'Conversation',
        isRunning: false,
        parentSessionId: null,
        work: [],
        messages: [],
        ...patch,
      }) as unknown as UiSession,
  )
  useChatStore.setState({ allSessions: roster, sessions: roster })
}

describe('restart to update', () => {
  test('asks first, naming the running turn, and installs only on a yes', async () => {
    await seedRoster([{ title: 'Release notes', isRunning: true }])
    const { decideConfirmation, pendingConfirmation, registerConfirmationHost } =
      await import('@/shared/lib/confirmAction')
    const { restartToUpdate } = await import('./restartToUpdate')
    const unmount = registerConfirmationHost()
    const busy: boolean[] = []
    let applied = 0

    await restartToUpdate(
      async () => {
        applied += 1
        return { ok: true }
      },
      (value) => busy.push(value),
    )

    expect(applied).toBe(0)
    expect(pendingConfirmation()?.detail).toContain('1 agent turn in Release notes')
    decideConfirmation(true)
    await Promise.resolve()
    expect(applied).toBe(1)
    expect(busy[0]).toBe(true)
    unmount()
  })

  test('counts every project, not only the open one — a restart stops them all', async () => {
    await seedRoster([{ title: 'Here' }, { title: 'Other project', isRunning: true }])
    const { useChatStore } = await import('./store')
    const [here] = useChatStore.getState().allSessions
    useChatStore.setState({ sessions: [here!] })
    const { pendingConfirmation, registerConfirmationHost } =
      await import('@/shared/lib/confirmAction')
    const { restartToUpdate } = await import('./restartToUpdate')
    const unmount = registerConfirmationHost()

    await restartToUpdate(
      async () => ({ ok: true }),
      () => {},
    )

    expect(pendingConfirmation()?.detail).toContain('1 agent turn in Other project')
    unmount()
  })

  test('a declined restart installs nothing', async () => {
    await seedRoster([{ isRunning: true }])
    const { decideConfirmation, registerConfirmationHost } =
      await import('@/shared/lib/confirmAction')
    const { restartToUpdate } = await import('./restartToUpdate')
    const unmount = registerConfirmationHost()
    let applied = 0

    await restartToUpdate(
      async () => {
        applied += 1
        return { ok: true }
      },
      () => {},
    )
    decideConfirmation(false)

    expect(applied).toBe(0)
    unmount()
  })

  test('installs at once when nothing would be interrupted, and clears busy on failure', async () => {
    await seedRoster([{ title: 'Idle' }])
    const { pendingConfirmation, registerConfirmationHost } =
      await import('@/shared/lib/confirmAction')
    const { restartToUpdate } = await import('./restartToUpdate')
    const unmount = registerConfirmationHost()
    const busy: boolean[] = []

    await restartToUpdate(
      async () => ({ ok: false, error: 'signature verification failed' }),
      (value) => busy.push(value),
    )

    expect(pendingConfirmation()).toBeNull()
    expect(busy).toEqual([true, false])
    unmount()
  })
})
