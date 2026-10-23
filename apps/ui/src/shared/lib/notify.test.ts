import { beforeEach, describe, expect, it } from 'bun:test'
import { TOAST_ACTION_LIFETIME_MS, toast } from './notify'
import { notificationCommandAvailable } from './notifications/commandRegistry'
import { pendingOps } from './notifications/outbox'
import { useNotificationPrefs } from './notifications/prefs'
import { resetNotificationsForTests, useNotificationsStore } from './notifications/store'
import { resetActiveEventRoute, setActiveEventRoute } from './notifications/context'
import { transientFeedback } from './notifications/transientFeedback'

const entries = () => useNotificationsStore.getState().entries
const raises = () => pendingOps().flatMap((op) => (op.op === 'raise' ? [op.fact] : []))

describe('notification compatibility publisher', () => {
  beforeEach(() => {
    resetNotificationsForTests()
    useNotificationPrefs.getState().setCondition('always')
    resetActiveEventRoute()
  })

  it("retires a toast's buttons once their moment has passed", () => {
    toast.warning('Renamed “a.ts” over an open file', {
      action: { label: 'Undo', onClick: () => {} },
    })
    const [action] = entries()[0]!.actions!
    expect(notificationCommandAvailable(action!)).toBe(true)
    // An Undo clicked an hour later would revert whatever changed last, not this rename.
    expect(
      notificationCommandAvailable(action!, undefined, Date.now() + TOAST_ACTION_LIFETIME_MS),
    ).toBe(false)
  })

  it('keeps the callback in this window and sends the server only what can be replayed', () => {
    toast.error('Push rejected', { action: { label: 'Force push', onClick: () => {} } })
    const [fact] = raises()
    // The row is on screen with its button, but the journal record carries no callback.
    expect(entries()[0]!.actions?.map((action) => action.label)).toEqual(['Force push'])
    expect(fact?.actions).toBeUndefined()
  })

  it('records every UI error as its own fact, folded into one row when it repeats', () => {
    toast.error('Could not save', { description: 'Try again' })
    toast.error('Could not save', { description: 'Try again' })

    const [first, second] = raises()
    // Two invocations, two keys — the server decides they are one fact seen twice.
    expect(first?.key).not.toBe(second?.key)
    expect(first?.coalesce && second?.coalesce).toBe(true)
    expect(entries()).toMatchObject([
      { severity: 'error', title: 'Could not save', message: 'Try again', occurrenceCount: 2 },
    ])
    expect(entries()).toHaveLength(1)
  })

  it('preserves caller-supplied ids', () => {
    expect(toast.error('Could not save', { id: 'save-error' })).toBe('save-error')
  })

  it('attaches the authoritative React Router session to a generic UI error', () => {
    setActiveEventRoute('/project/PRJ-1/LOCALIX-17')
    toast.error('“Stop stream” is no longer available.')

    expect(entries()[0]).toMatchObject({
      title: '“Stop stream” is no longer available.',
      origin: { kind: 'session', sessionId: 'LOCALIX-17', projectId: 'PRJ-1' },
    })
  })

  // A mini app's row used to read "System". Its label must name the mini app WITHOUT replacing the
  // origin the row would get, or it would stop filing under the chat it happened in.
  it('labels the derived origin with the source instead of replacing it', () => {
    setActiveEventRoute('/project/PRJ-1/LOCALIX-19')
    toast.error('Could not connect', { source: 'Database' })
    toast.error('Could not save')

    expect(entries().map((entry) => entry.origin)).toEqual([
      { kind: 'session', sessionId: 'LOCALIX-19', projectId: 'PRJ-1' },
      { kind: 'session', sessionId: 'LOCALIX-19', projectId: 'PRJ-1', label: 'Database' },
    ])
  })

  // A routine success used to be a quiet row — still an unread count for a click. It is an answer
  // to the person's own action now: the transient line, and nothing for the journal to send.
  it('records routine success nowhere durable', () => {
    toast.success('Copied')
    toast.info('Nothing to undo')
    expect(entries()).toEqual([])
    expect(raises()).toEqual([])
    expect(transientFeedback.getSnapshot()).toMatchObject({ message: 'Nothing to undo' })
    transientFeedback.clear()
  })
})
