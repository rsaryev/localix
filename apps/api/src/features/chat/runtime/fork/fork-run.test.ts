import { describe, expect, test } from 'bun:test'

import { captureForkSeed } from '../../../agent-core/fork-seed'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import { routedAgent, sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import { loadForkRun, runCacheKey } from './fork-run'

const seed = captureForkSeed({
  systemPrompt: 'S',
  tools: [],
  cacheSessionId: 'parent',
  toolNames: [],
  profile: resolveRunProfile({ sessionKind: 'chat' }),
})

const forkSession = sessionFixture({
  id: 'fork',
  sessionKind: 'subagent',
  agent: routedAgent(),
  provenance: {
    kind: 'task-delegation',
    parentSessionId: 'parent',
    toolCallId: 'd1',
    fork: { baseMessageId: 'u2', snapshotMessageId: 'copy' },
  },
})

const row = (id: string, sessionId: string, role: 'user' | 'assistant'): PersistedMessage =>
  ({ id, sessionId, userId: 'u', payload: { id, role, content: id } }) as never

const repo = (found: typeof seed | null = seed) => ({
  getForkSeed: async () => found ?? undefined,
})

describe('loading the fork a run belongs to', () => {
  test('a session that is no fork has none', async () => {
    const plain = sessionFixture({ id: 'plain' })
    expect(await loadForkRun(repo(), 'u', plain, [], 'run')).toBeUndefined()
  })

  test('its first run is the one before any run of its own has answered', async () => {
    const history = [
      row('u1', 'parent', 'user'),
      row('copy', 'fork', 'assistant'),
      row('dir', 'fork', 'user'),
    ]
    const run = await loadForkRun(repo(), 'u', forkSession, history, 'run')
    expect(run).toMatchObject({ toolCallId: 'd1', snapshotMessageId: 'copy', first: true })
    expect(run?.seed.systemPrompt).toBe('S')
  })

  test('a later run follows an answer of the fork’s own', async () => {
    const history = [
      row('u1', 'parent', 'user'),
      row('copy', 'fork', 'assistant'),
      row('dir', 'fork', 'user'),
      row('answer', 'fork', 'assistant'),
      row('more', 'fork', 'user'),
    ]
    expect((await loadForkRun(repo(), 'u', forkSession, history, 'run'))?.first).toBe(false)
  })

  test('the row the run itself is writing is not an answer already given', async () => {
    const history = [
      row('copy', 'fork', 'assistant'),
      row('dir', 'fork', 'user'),
      row('run', 'fork', 'assistant'),
    ]
    expect((await loadForkRun(repo(), 'u', forkSession, history, 'run'))?.first).toBe(true)
  })

  test('a fork whose seed is gone does not run as an ordinary child', async () => {
    await expect(loadForkRun(repo(null), 'u', forkSession, [], 'run')).rejects.toThrow(/seed/)
  })
})

describe('how a run keys the provider cache', () => {
  const own = { promptCacheKey: 'lx-shared', idleMs: 90_000, retention: undefined }

  test('an ordinary run is keyed by the key of its agent, model and project', () => {
    expect(runCacheKey(undefined, own)).toEqual(own)
  })

  test('a fork’s first run is keyed by its parent’s key, with no idle gap', async () => {
    const run = await loadForkRun(repo(), 'u', forkSession, [row('copy', 'fork', 'assistant')], 'r')
    expect(runCacheKey(run, own)).toEqual({
      promptCacheKey: 'parent',
      idleMs: 0,
      retention: undefined,
    })
  })

  test('its later runs keep the key and report the idle time they had', async () => {
    const history = [row('copy', 'fork', 'assistant'), row('answer', 'fork', 'assistant')]
    const run = await loadForkRun(repo(), 'u', forkSession, history, 'r')
    expect(runCacheKey(run, own)).toEqual({
      promptCacheKey: 'parent',
      idleMs: 90_000,
      retention: undefined,
    })
  })
})
