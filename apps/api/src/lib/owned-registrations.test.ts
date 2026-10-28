import { describe, expect, test } from 'bun:test'
import { createOwnedRegistrations } from './owned-registrations'

/** A registry entry that records when it is opened and released. */
function entry() {
  const log: string[] = []
  const open = (_current: () => string) => {
    log.push('opened')
    return () => log.push('released')
  }
  return { log, open }
}

describe('owned registrations: one entry, the load the host settled answers', () => {
  test('a second load shares the entry and the newest answers until the host settles', () => {
    const owned = createOwnedRegistrations()
    const { log } = entry()
    let current = () => ''
    const open = (read: () => string) => {
      current = read
      log.push('opened')
      return () => log.push('released')
    }
    owned.bind('app', 'k', 'first', open)
    owned.bind('app', 'k', 'second', open)
    expect(log).toEqual(['opened'])
    expect(current()).toBe('second')
  })

  test('kept goes back to the wired load; replaced makes the newest the wired one', () => {
    const owned = createOwnedRegistrations()
    let current = () => ''
    const open = (read: () => string) => {
      current = read
      return () => undefined
    }
    owned.bind('app', 'k', 'one', open)
    owned.settle('app', 'replaced')
    owned.bind('app', 'k', 'two', open)
    owned.settle('app', 'kept')
    expect(current()).toBe('one')
    owned.bind('app', 'k', 'three', open)
    owned.settle('app', 'replaced')
    owned.bind('app', 'k', 'four', open)
    owned.settle('app', 'kept')
    expect(current()).toBe('three')
  })

  test('a disposer frees the entry only with the last load, and a passed-over load is inert', async () => {
    const owned = createOwnedRegistrations()
    const { log, open } = entry()
    const first = owned.bind('app', 'k', 'one', open)
    const second = owned.bind('app', 'k', 'two', open)
    owned.settle('app', 'replaced')
    first.dispose()
    expect(log).toEqual(['opened'])
    second.dispose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toEqual(['opened', 'released'])
  })

  test('a failed open leaves nothing behind, so the next load opens again', async () => {
    const owned = createOwnedRegistrations()
    expect(() =>
      owned.bind('app', 'k', 'one', () => {
        throw new Error('refused')
      }),
    ).toThrow('refused')
    const { log, open } = entry()
    owned.bind('app', 'k', 'two', open)
    await owned.releaseOwner('app')
    expect(log).toEqual(['opened', 'released'])
  })

  test('releasing an owner waits for an entry still opening, and leaves another owner alone', async () => {
    const owned = createOwnedRegistrations()
    const log: string[] = []
    owned.bind('a', 'k', 'x', async () => {
      await Promise.resolve()
      return () => log.push('a released')
    })
    owned.bind('b', 'k', 'x', () => () => log.push('b released'))
    await owned.releaseOwner('a')
    expect(log).toEqual(['a released'])
  })
})
