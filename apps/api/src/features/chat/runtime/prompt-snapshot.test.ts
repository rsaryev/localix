import { expect, test } from 'bun:test'

import type { ParticipantLaneSnapshotRepository } from '../participant-lane-snapshot-repository'
import type { FrozenSessionContext } from './frozen-session-context'
import { resolvePromptSnapshot } from './prompt-snapshot'
import { createSessionSnapshotCache } from './session-snapshot'

test('catalog changes reach an existing lane while unchanged prefixes and frozen memory survive', async () => {
  let stored: FrozenSessionContext | undefined
  let writes = 0
  let initialized = 0
  const store: ParticipantLaneSnapshotRepository = {
    get: async () => stored,
    set: async (_user, _address, _boundary, snapshot) => {
      stored = snapshot
      writes += 1
    },
  }
  const input = {
    cache: createSessionSnapshotCache<FrozenSessionContext>(),
    store,
    userId: 'user',
    address: { sessionId: 'session', agentId: 'agent' },
    boundary: '',
    fresh: {
      memoryContext: 'frozen note',
      memoryScopesRevision: 'memory-v1',
    } as FrozenSessionContext,
    initialize: async () => {
      initialized += 1
    },
  }
  const original = await resolvePromptSnapshot(input)
  input.fresh = { ...input.fresh, memoryContext: 'later note', skillsContext: '- /design-review' }
  const updated = await resolvePromptSnapshot(input)
  expect(updated.skillsContext).toBe('- /design-review')
  expect(updated.memoryContext).toBe(original.memoryContext)
  expect(initialized).toBe(1)
  expect(writes).toBe(2)
  expect(await resolvePromptSnapshot(input)).toBe(updated)
  expect(writes).toBe(2)

  // A restart reads the durable snapshot without rebuilding its bytes.
  input.cache = createSessionSnapshotCache<FrozenSessionContext>()
  expect(await resolvePromptSnapshot(input)).toBe(updated)
  expect(writes).toBe(2)
  input.fresh = { ...input.fresh, skillsContext: undefined }
  const removed = await resolvePromptSnapshot(input)
  expect(removed.skillsContext).toBeUndefined()
  expect(removed.memoryContext).toBe(original.memoryContext)
  expect(writes).toBe(3)
})
