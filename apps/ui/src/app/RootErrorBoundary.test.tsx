import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { setActiveEventRoute } from '@/shared/lib/notifications/context'
import { resetNotificationsForTests, useNotificationsStore } from '@/shared/lib/notifications/store'
import { resetEventTrace } from '@/shared/lib/notifications/trace'
import { reportRootRenderFailure } from './RootErrorBoundary'

beforeEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
  setActiveEventRoute('/project/project-1/LOCALIX-18')
})

describe('root render failure reporting', () => {
  it('persists the last-resort crash without blaming the visible session', async () => {
    await reportRootRenderFailure(new TypeError('The shell crashed'))

    expect(useNotificationsStore.getState().entries[0]).toMatchObject({
      severity: 'error',
      title: 'The window could not render',
      message: 'The shell crashed',
      origin: { kind: 'application' },
    })
  })

  it('does not rethrow if the reporter itself cannot log', async () => {
    const previous = console.error
    const log = mock(() => {})
    console.error = log
    try {
      // A revoked proxy makes Error property reads throw inside the reporter.
      const target = new Error('broken reporter input')
      const { proxy, revoke } = Proxy.revocable(target, {})
      revoke()
      await reportRootRenderFailure(proxy)
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      console.error = previous
    }
  })
})
