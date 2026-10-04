import { afterEach, describe, expect, it } from 'bun:test'
import {
  executeNotificationCommand,
  notificationCommandAvailable,
  registerNotificationCommand,
  resetNotificationCommandsForTests,
} from './commandRegistry'
import type { NotificationAction, NotificationEntry } from './types'

afterEach(resetNotificationCommandsForTests)

const entry: NotificationEntry = {
  id: 'event-1',
  topic: 'application.notification',
  category: 'system',
  severity: 'error',
  title: 'Failed',
  origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: null },
  ts: 1_000,
  read: false,
}

const action: NotificationAction = {
  id: 'retry',
  label: 'Retry',
  kind: 'invoke',
  command: 'agent.retry',
  available: true,
}

describe('notification command registry', () => {
  it('dispatches an agnostic command with source-derived session context', async () => {
    const seen: string[] = []
    const unregister = registerNotificationCommand('agent.retry', ({ target }) => {
      if (target) seen.push(target.sessionId)
    })

    expect(notificationCommandAvailable(action)).toBe(true)
    expect(await executeNotificationCommand(entry, action)).toBe(true)
    expect(seen).toEqual(['LOCALIX-18'])
    unregister()
    expect(notificationCommandAvailable(action)).toBe(false)
    expect(await executeNotificationCommand(entry, action)).toBe(false)
  })

  it('awaits asynchronous handlers and propagates their failure to the caller', async () => {
    registerNotificationCommand('agent.retry', async () => {
      await Promise.resolve()
      throw new Error('retry exploded')
    })

    expect(executeNotificationCommand(entry, action)).rejects.toThrow('retry exploded')
  })

  it('rejects invalid and duplicate command ownership', () => {
    expect(() => registerNotificationCommand('Bad command', () => {})).toThrow()
    registerNotificationCommand('agent.retry', () => {})
    expect(() => registerNotificationCommand('agent.retry', () => {})).toThrow()
  })
})
