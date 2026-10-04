import { describe, expect, test } from 'bun:test'
import { SearchRequestCoordinator } from './searchRequestCoordinator'

describe('SearchRequestCoordinator', () => {
  test('invalidates an old result immediately, before the next debounced request starts', () => {
    const requests = new SearchRequestCoordinator()
    const first = requests.beginPrimary()
    requests.invalidate()
    expect(first.controller.signal.aborted).toBe(true)
    expect(requests.isCurrent(first)).toBe(false)
  })

  test('new primary search aborts old primary and pagination', () => {
    const requests = new SearchRequestCoordinator()
    const first = requests.beginPrimary()
    const more = requests.beginMore()!
    const second = requests.beginPrimary()
    expect(first.controller.signal.aborted).toBe(true)
    expect(more.controller.signal.aborted).toBe(true)
    expect(requests.isCurrent(second)).toBe(true)
  })

  test('allows only one pagination request until the current one finishes', () => {
    const requests = new SearchRequestCoordinator()
    requests.beginPrimary()
    const first = requests.beginMore()!
    expect(requests.beginMore()).toBeNull()
    requests.finish(first)
    expect(requests.beginMore()).not.toBeNull()
  })
})
