import { afterEach, describe, expect, test } from 'bun:test'

import { resourceKeyAffected, resourceTopic, resetResourceTopics } from './resource-topics'

afterEach(resetResourceTopics)

describe('resource topics', () => {
  test('the same name is the same topic, so a writer and a reader always meet', () => {
    // Two modules declaring it independently is the NORMAL case — the client announces, the status
    // item listens, and neither imports the other. Separate handles would be two dead ends that
    // look wired.
    let heard = 0
    resourceTopic('acme:environments').subscribe(() => (heard += 1))
    resourceTopic('acme:environments').invalidate()
    expect(heard).toBe(1)
  })

  test('a listener that unsubscribes stops hearing', () => {
    let heard = 0
    const stop = resourceTopic('t').subscribe(() => (heard += 1))
    resourceTopic('t').invalidate()
    stop()
    resourceTopic('t').invalidate()
    expect(heard).toBe(1)
  })

  test('unsubscribing DURING a fire does not skip the next listener', () => {
    // A resource that finishes loading inside its own invalidation is ordinary, and iterating the
    // live set would silently drop whoever came after it.
    const topic = resourceTopic('t')
    const heard: string[] = []
    const stop = topic.subscribe(() => {
      heard.push('first')
      stop()
    })
    topic.subscribe(() => heard.push('second'))
    topic.invalidate()
    expect(heard).toEqual(['first', 'second'])
  })

  test('topics do not leak into each other', () => {
    let heard = 0
    resourceTopic('a').subscribe(() => (heard += 1))
    resourceTopic('b').invalidate()
    expect(heard).toBe(0)
  })

  test('a key says WHICH scope moved, and reaches only the readers it concerns', () => {
    const topic = resourceTopic('acme:courses')
    const heard: (string | null)[] = []
    topic.subscribe((key) => heard.push(key))
    topic.invalidate('session-1')
    topic.invalidate()
    expect(heard).toEqual(['session-1', null])
  })
})

describe('resourceKeyAffected', () => {
  test('an unkeyed invalidation reaches everyone — it is the "something changed" case', () => {
    expect(resourceKeyAffected('session-1', null)).toBe(true)
    expect(resourceKeyAffected(null, null)).toBe(true)
  })

  test('a keyed invalidation reaches that key only', () => {
    expect(resourceKeyAffected('session-1', 'session-1')).toBe(true)
    expect(resourceKeyAffected('session-2', 'session-1')).toBe(false)
  })

  test('a reader watching no key in particular hears every key', () => {
    // A surface that shows "whatever is current" rather than one scope — it cannot know in advance
    // which key the answer will come from, so it must look on any of them.
    expect(resourceKeyAffected(null, 'session-1')).toBe(true)
    expect(resourceKeyAffected(undefined, 'session-1')).toBe(true)
  })
})
