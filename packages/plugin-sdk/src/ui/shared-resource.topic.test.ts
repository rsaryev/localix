import { afterEach, describe, expect, test } from 'bun:test'

import { createSharedResource, GLOBAL_RESOURCE_KEY } from './shared-resource'
import { resourceTopic, resetResourceTopics } from './resource-topics'

afterEach(resetResourceTopics)

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a resource that follows a topic', () => {
  test('re-reads a loaded key when its topic is invalidated', async () => {
    // The whole point: a writer announces, and every reader corrects itself without either of them
    // knowing the other exists. Two bundled plugins shipped the reader and the refresh function
    // with nothing in between, and their titlebar showed the app's start-up state forever.
    let reads = 0
    const topic = resourceTopic('test:list')
    const resource = createSharedResource(async () => ++reads, { topic })
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe(1)

    topic.invalidate()
    await settle()
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe(2)
  })

  test('does not fetch a key nobody has asked for', async () => {
    // An invalidation must not become a request per plugin per session. A key with no value has
    // nothing to correct.
    let reads = 0
    const topic = resourceTopic('test:list')
    createSharedResource(
      async () => {
        reads += 1
        return reads
      },
      { topic },
    )
    topic.invalidate()
    await settle()
    expect(reads).toBe(0)
  })

  test('a keyed invalidation re-reads that session and leaves the others alone', async () => {
    const loaded: string[] = []
    const topic = resourceTopic('test:by-session')
    const resource = createSharedResource(
      async (key) => {
        loaded.push(key)
        return key
      },
      { topic },
    )
    resource.refresh('s1')
    resource.refresh('s2')
    await settle()
    loaded.length = 0

    topic.invalidate('s1')
    await settle()
    expect(loaded).toEqual(['s1'])
  })

  test('a resource with no topic is unchanged — the option is additive', async () => {
    let reads = 0
    const topic = resourceTopic('test:list')
    const resource = createSharedResource(async () => ++reads)
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    topic.invalidate()
    await settle()
    expect(resource.peek(GLOBAL_RESOURCE_KEY)).toBe(1)
  })

  test('disposing stops the following, so a torn-down resource cannot be revived', async () => {
    let reads = 0
    const topic = resourceTopic('test:list')
    const resource = createSharedResource(async () => ++reads, { topic })
    resource.refresh(GLOBAL_RESOURCE_KEY)
    await settle()
    resource.dispose()
    topic.invalidate()
    await settle()
    expect(reads).toBe(1)
  })
})
