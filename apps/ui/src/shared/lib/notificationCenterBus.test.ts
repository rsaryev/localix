import { describe, expect, it } from 'bun:test'
import { openNotificationCenter, subscribeNotificationCenter } from './notificationCenterBus'

describe('notificationCenterBus', () => {
  it('fires subscribers on open', () => {
    let count = 0
    const unsub = subscribeNotificationCenter(() => {
      count += 1
    })
    openNotificationCenter()
    openNotificationCenter()
    expect(count).toBe(2)
    unsub()
  })

  it('stops firing after unsubscribe', () => {
    let count = 0
    const unsub = subscribeNotificationCenter(() => {
      count += 1
    })
    openNotificationCenter()
    unsub()
    openNotificationCenter()
    expect(count).toBe(1)
  })

  it('open with no subscribers is a no-op', () => {
    expect(() => openNotificationCenter()).not.toThrow()
  })
})
