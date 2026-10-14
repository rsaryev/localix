import { expect, test } from 'bun:test'
import { SYSTEM_PARTICIPANT, USER_PARTICIPANT } from '../../../db'
import type { PersistedMessage } from '../contracts'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import {
  createSteeredUserMessage,
  insertSteeredUserMessage,
  insertUiNote,
} from './message-persistence'

function fixture() {
  const calls: string[] = []
  const stored = new Map<string, PersistedMessage>()
  const repo = {
    async getMessage(_user: string, _session: string, id: string) {
      calls.push('get')
      return stored.get(id) ?? null
    },
    async insertMessage(message: PersistedMessage) {
      calls.push('insert')
      stored.set(message.id, message)
    },
  }
  const stream = {
    publish() {
      calls.push('publish')
    },
  }
  const params = {
    repo: repo as unknown as ChatRepository,
    streamRegistry: stream as unknown as SessionStreamRegistry,
    now: () => {
      calls.push('now')
      return '2026-10-09T00:00:00Z'
    },
    userId: 'user',
    sessionId: 'session',
    messageId: 'delivery',
    content: 'Steer this run',
  }
  return { calls, stored, repo, stream, params }
}

test('replayed standalone delivery returns its committed row without inserting or publishing again', async () => {
  const { calls, params } = fixture()
  const first = await insertSteeredUserMessage(params)
  const replayed = await insertSteeredUserMessage(params)
  expect(replayed).toBe(first)
  expect(calls).toEqual(['now', 'get', 'insert', 'publish', 'now', 'get'])
  expect(first.payload.from).toEqual(USER_PARTICIPANT)
  expect(first.payload.origin).toBe('user-steer')
})

test('an insert race returns the winning delivery without publishing it twice', async () => {
  const { calls, repo, params } = fixture()
  const winner = createSteeredUserMessage({ ...params, internal: false })
  calls.length = 0
  let reads = 0
  repo.getMessage = async () => {
    calls.push('get')
    return ++reads === 1 ? null : winner
  }
  repo.insertMessage = async () => {
    calls.push('insert')
    throw new Error('another writer won')
  }
  expect(await insertSteeredUserMessage(params)).toBe(winner)
  expect(calls).toEqual(['now', 'get', 'insert', 'get'])
})

test('an insert failure without a committed delivery propagates the original error', async () => {
  const { calls, repo, params } = fixture()
  const failure = new Error('database unavailable')
  repo.insertMessage = async () => {
    calls.push('insert')
    throw failure
  }
  await expect(insertSteeredUserMessage(params)).rejects.toBe(failure)
  expect(calls).toEqual(['now', 'get', 'insert', 'get'])
})

test('replay after a publication failure keeps the already-inserted standalone row', async () => {
  const { calls, stored, stream, params } = fixture()
  const failure = new Error('subscriber failed')
  stream.publish = () => {
    calls.push('publish')
    throw failure
  }
  await expect(insertSteeredUserMessage(params)).rejects.toBe(failure)
  const committed = stored.get('delivery')
  if (!committed) throw new Error('Publication failure lost the committed delivery')
  expect(await insertSteeredUserMessage(params)).toBe(committed)
  expect(calls).toEqual(['now', 'get', 'insert', 'publish', 'now', 'get'])
})

test('UI notes and internal steering retain their distinct authorship and visibility', async () => {
  const { params } = fixture()
  const note = await insertUiNote(params)
  expect(note.payload.from).toEqual(SYSTEM_PARTICIPANT)
  expect(note.payload.uiOnly).toBe(true)
  const internal = createSteeredUserMessage({ ...params, internal: true, source: 'plugin' })
  expect(internal.payload.from).toEqual(USER_PARTICIPANT)
  expect(internal.payload.isInternal).toBe(true)
  expect(internal.payload.origin).toBe('plugin')
})
