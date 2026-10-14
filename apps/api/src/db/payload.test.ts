import { describe, expect, test } from 'bun:test'
import {
  MESSAGE_PAYLOAD_VERSION,
  mergeMessagePayload,
  serializeMessagePayload,
  deserializeMessagePayload,
  type StoredMessagePayload,
  type StoredMessagePatch,
} from './payload'
import type { MessageTiming, MessageProviderMeta } from '../features/chat/contracts'
import { USER_PARTICIPANT } from './participant'

// The persistence boundary for chat history. These guard that the round-trip is
// FAITHFUL — if anyone makes it lossy (field-stripping, compression) the special
// fields below would silently stop surviving a reload.
describe('message payload serialization', () => {
  const rich: StoredMessagePayload = {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    reasoning: 'because',
    items: [{ type: 'text', text: 'hello', status: 'completed' }],
    isInternal: true,
    contextBoundary: true,
    pinned: true,
    commandOrigin: { command: '/loop', label: 'Loop' },
    timing: { totalMs: 1200, modelMs: 800, toolMs: 100, idleMs: 300 } as MessageTiming,
    providerMeta: {
      providerName: 'OpenRouter',
      modelId: 'meta-llama/llama-3.1',
    } as MessageProviderMeta,
  } as StoredMessagePayload

  test('round-trips a rich payload, preserving every special persistence field', () => {
    // The stamp is the one field the round trip ADDS: it describes the stored form, so a
    // value built in memory does not carry it and a value read back always does.
    expect(deserializeMessagePayload(serializeMessagePayload(rich))).toEqual({
      ...rich,
      v: MESSAGE_PAYLOAD_VERSION,
    })
  })

  test('round-trips a resolved context binding alongside ordinary payload fields', () => {
    const payload: StoredMessagePayload = {
      id: 'u1',
      role: 'user',
      from: USER_PARTICIPANT,
      content: '@resource:localix://resource/fixture-db/c/users',
      bindings: [
        {
          kind: 'context',
          id: 'r1',
          source: 'mention',
          assets: [
            {
              kind: 'image',
              mediaType: 'image/jpeg',
              mediaId: 'preview-shot.jpg',
              name: 'preview-shot.jpg',
              size: 42,
            },
          ],
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/fixture-db/c/users',
            label: 'users',
            uri: 'localix://resource/fixture-db/c/users',
          },
          resolution: {
            status: 'resolved',
            capturedAt: '2026-07-12T00:00:00.000Z',
            contributions: [
              {
                id: 'c1',
                providerId: 'fixture:context',
                providerVersion: '1',
                scope: 'session',
                kind: 'database-schema',
                content: 'CREATE TABLE users()',
                revision: 'db-content:1:20',
                sensitivity: 'project',
              },
            ],
          },
        },
      ],
    }
    expect(deserializeMessagePayload(serializeMessagePayload(payload))).toEqual({
      ...payload,
      v: MESSAGE_PAYLOAD_VERSION,
    })
  })

  test('serialize produces valid JSON; deserialize is its inverse', () => {
    const json = serializeMessagePayload(rich)
    expect(typeof json).toBe('string')
    expect(JSON.parse(json)).toEqual({ ...rich, v: MESSAGE_PAYLOAD_VERSION } as unknown as Record<
      string,
      unknown
    >)
    expect(deserializeMessagePayload(json).pinned).toBe(true)
    expect(deserializeMessagePayload(json).contextBoundary).toBe(true)
  })

  test('a minimal payload (id + role only) survives, plus its stamp', () => {
    const min = { id: 'u1', role: 'user' } as StoredMessagePayload
    expect(deserializeMessagePayload(serializeMessagePayload(min))).toEqual({
      ...min,
      v: MESSAGE_PAYLOAD_VERSION,
    })
  })

  test('only the codec states the version — a caller cannot forge one', () => {
    const forged = { id: 'u1', role: 'user', v: 99 } as StoredMessagePayload
    // The serializer overwrites whatever arrived, so a value that somehow carried a foreign
    // version cannot round-trip it back into storage.
    expect(JSON.parse(serializeMessagePayload(forged)).v).toBe(MESSAGE_PAYLOAD_VERSION)
  })
})

test('a streaming patch cannot stamp a continuation onto the previous assistant row', () => {
  const first: StoredMessagePayload = {
    id: 'before',
    role: 'assistant',
    from: 'agent:builtin:localix',
    content: 'part one',
  }
  const second: StoredMessagePayload = {
    ...first,
    id: 'after',
    continuedFromMessageId: 'before',
  }
  const forgedPatch = second as unknown as StoredMessagePatch
  expect(mergeMessagePayload(first, forgedPatch).continuedFromMessageId).toBeUndefined()
  expect(mergeMessagePayload(second, { content: 'part two' }).continuedFromMessageId).toBe('before')
})

describe('the version is refused in both directions', () => {
  const stored = (extra: Record<string, unknown>) =>
    JSON.stringify({ id: 'm1', role: 'assistant', content: 'x', ...extra })

  test('an older row names the migration that should have reached it', () => {
    // Recoverable: the row exists, it just was not normalized. The message has to say so,
    // because the alternative — reading it anyway — loses fields with no symptom.
    expect(() => deserializeMessagePayload(stored({ v: 0 }))).toThrow(/predates this build/)
    expect(() => deserializeMessagePayload(stored({ v: 0 }))).toThrow(
      /stamp_message_payload_version/,
    )
  })

  test('an unstamped row is treated as older, not as current', () => {
    // Every row in every database written before the stamp looks like this. Accepting it
    // would make the whole version pointless; the migration is what turns it into a
    // stamped row before any read happens.
    expect(() => deserializeMessagePayload(stored({}))).toThrow(/predates this build/)
    expect(() => deserializeMessagePayload(stored({ v: 'nonsense' }))).toThrow(
      /predates this build/,
    )
  })

  test('a newer row says downgrading is not the answer', () => {
    // No migration fixes this direction, so the message points at the only recovery that
    // exists: the newer build, or the snapshot the connection layer keeps.
    expect(() => deserializeMessagePayload(stored({ v: 2 }))).toThrow(/written by a NEWER build/)
    expect(() => deserializeMessagePayload(stored({ v: 2 }))).toThrow(/backups\/migrations/)
  })

  test('the current version reads through untouched', () => {
    const payload = deserializeMessagePayload(stored({ v: MESSAGE_PAYLOAD_VERSION }))
    expect(payload.content).toBe('x')
  })
})
