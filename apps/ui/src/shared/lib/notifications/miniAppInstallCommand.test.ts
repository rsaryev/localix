import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { executeNotificationCommand, resetNotificationCommandsForTests } from './commandRegistry'
import { startNotificationCommandHandlers } from './runtime'
import type { NotificationAction, NotificationEntry } from './types'

afterEach(() => resetNotificationCommandsForTests())

/** The row the server records for an install that did not finish (`producers/mini-app-installs`). */
const tryAgain: NotificationAction = {
  id: 'retry',
  label: 'Try again',
  kind: 'invoke',
  command: 'mini_app_install',
  requestId: 'kanban',
  available: true,
}
const failed = {
  id: 'mini-app-failed:kanban:1.0.0',
  title: 'Could not install Kanban',
  origin: { kind: 'application', label: 'Mini apps' },
  actions: [tryAgain],
} as unknown as NotificationEntry

describe('Try again on a mini app that did not install', () => {
  test('queues the same app again; its progress and outcome come from the store', async () => {
    const install = spyOn(backendClient, 'installMiniApp').mockResolvedValue(undefined)
    const stop = startNotificationCommandHandlers()
    expect(await executeNotificationCommand(failed, tryAgain)).toBe(true)
    expect(install).toHaveBeenCalledWith('kanban')
    stop()
    install.mockRestore()
  })
})
