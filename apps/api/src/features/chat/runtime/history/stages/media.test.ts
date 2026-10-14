/**
 * The media seam: persisted rows → model payloads. Every transform here is WIRE-ONLY; the
 * stored row is what the UI renders and must come out untouched.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { PersistedMessage } from '../../../contracts'
import { createMediaStore } from '../../../../media/store'
import { persistedRow } from '../test-fixtures'
import { findActiveInvocationIndex, toModelPayloads } from './media'

const seam = (messages: PersistedMessage[], deps = {}) => toModelPayloads(messages, deps)

describe('media seam — bytes reach the wire only when the wire carries them', () => {
  test('copies stored file bytes directly while still rehydrating a png wire part', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'history-media-'))
    const store = createMediaStore({ dir: path.join(dir, 'media') })
    const fileBytes = Buffer.from('PK stored zip payload')
    const pngBytes = Buffer.from('small png wire payload')
    const storedFile = await store.putBytes(fileBytes, 'application/zip', {
      nameHint: 'archive.zip',
    })
    const storedPng = await store.putBytes(pngBytes, 'image/png', { nameHint: 'shot.png' })
    const base64Reads: string[] = []
    const mediaStore = {
      ...store,
      async getBase64(id: string) {
        base64Reads.push(id)
        return store.getBase64(id)
      },
    }
    const message = persistedRow('u-media', {
      role: 'user',
      content: 'inspect these',
      bindings: [
        {
          kind: 'file',
          name: 'archive.zip',
          mediaType: 'application/zip',
          mediaId: storedFile.id,
          size: fileBytes.length,
        },
        {
          kind: 'image',
          name: 'shot.png',
          mediaType: 'image/png',
          mediaId: storedPng.id,
          size: pngBytes.length,
        },
      ],
    })

    const output = await seam([message], { mediaStore, defaultCwd: dir })

    expect(base64Reads).toEqual([storedPng.id])
    const spilled = output[0]?.bindings?.find((attachment) => attachment.kind === 'text')
    expect(spilled).toMatchObject({ kind: 'text', spilled: true })
    if (spilled?.kind !== 'text') throw new Error('expected spilled file manifest')
    expect(await readFile(path.resolve(dir, spilled.path!))).toEqual(fileBytes)
    const image = output[0]?.bindings?.find((attachment) => attachment.kind === 'image')
    expect(image).toMatchObject({
      kind: 'image',
      mediaId: storedPng.id,
      data: pngBytes.toString('base64'),
    })

    base64Reads.length = 0
    const withoutCwd = await seam([message], { mediaStore })
    expect(base64Reads).toEqual([storedFile.id, storedPng.id])
    expect(withoutCwd[0]?.bindings?.find((attachment) => attachment.kind === 'file')).toMatchObject(
      { kind: 'file', mediaId: storedFile.id, data: fileBytes.toString('base64') },
    )
  })

  test('materializes a persisted context binding only on the wire copy', async () => {
    const original = persistedRow('u1', {
      role: 'user',
      content: '@resource:localix://resource/fixture-db/c/users',
      bindings: [
        {
          kind: 'context',
          id: 'r1',
          source: 'mention',
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
                revision: 'r1',
                sensitivity: 'project',
              },
            ],
          },
        },
      ],
    })
    const output = await seam([original])
    expect(original.payload.bindings?.[0]?.kind).toBe('context')
    const attachment = output[0]?.bindings?.[0]
    expect(attachment).toMatchObject({ kind: 'text', name: '@context:c1', contextRef: true })
    if (attachment?.kind === 'text') expect(attachment.text).toContain('CREATE TABLE users()')
  })

  // Append-only between checkpoints: an invocation's instruction shown on the turn it was
  // typed must still be there, byte for byte, on every later turn — so it is materialized on
  // every row that carries one, not only on the newest prompt.
  test('materializes an invocation on every turn, not only while it is the newest prompt', async () => {
    const prompt = persistedRow('active-prompt', {
      role: 'user',
      content: '/sample-skill',
      bindings: [
        {
          kind: 'invocation',
          id: 'invoke-1',
          source: 'slash',
          invocation: { kind: 'skill', name: 'sample-skill', lifetime: 'turn' },
          presentation: { label: '/sample-skill', token: '/sample-skill' },
          instruction: 'Inspect the current diff carefully.',
        },
      ],
    })
    const answer = persistedRow('answer', { role: 'assistant', content: 'Reviewed.' })
    const next = persistedRow('next-prompt', { role: 'user', content: 'thanks, and now?' })

    const output = await seam([prompt, answer, next])

    const invocation = output[0]?.bindings?.find(
      (binding) => binding.kind === 'text' && binding.name === '/sample-skill',
    )
    expect(invocation).toMatchObject({ kind: 'text', contextRef: true })
    if (invocation?.kind === 'text') expect(invocation.text).toContain('Inspect the current diff')
    expect(output[2]?.bindings).toBeUndefined()
  })

  test('without an explicit trigger, the active invocation is the last real user row', () => {
    const rows = [
      persistedRow('u1', { from: 'user', role: 'user', content: 'a' }),
      persistedRow('a1', { role: 'assistant', content: 'b' }),
      persistedRow('u2', { from: 'user', role: 'user', content: 'c' }),
      persistedRow('marker', { role: 'user', content: 'Mode changed', uiOnly: true }),
      persistedRow('reminder', { role: 'user', content: 'Check state', isInternal: true }),
    ]
    expect(findActiveInvocationIndex(rows, undefined)).toBe(2)
    expect(findActiveInvocationIndex(rows, 'u1')).toBe(0)
    expect(findActiveInvocationIndex(rows, 'reminder')).toBe(4)
    expect(findActiveInvocationIndex(rows, 'missing')).toBe(-1)
  })
})

describe('steered user messages and the causality note', () => {
  // The steer SPLIT (run/steer-split.ts) normally makes the transcript read
  // part 1 → steer → part 2, which needs no help. The note exists only for a steer
  // that TRAILS the response that already reacted to it — without it a later run reads
  // the steer as unanswered and answers it a second time. DB rows untouched either way.
  const steered = persistedRow('steer-1', {
    role: 'user',
    content: 'stop doing X',
    origin: 'user-steer',
  })
  const assistantRow = (id: string) =>
    persistedRow(id, { role: 'assistant', content: `answer ${id}` })

  test('a TRAILING steer (no assistant row after it) gets the mid-run note', async () => {
    const out = await seam([assistantRow('a1'), steered])
    expect(String(out[1].content)).toContain('stop doing X')
    expect(String(out[1].content)).toContain('delivered MID-RUN')
    expect(steered.payload.content).toBe('stop doing X')
  })

  test('a correctly-SPLIT steer (assistant part 2 follows) is passed through verbatim', async () => {
    const out = await seam([assistantRow('part1'), steered, assistantRow('part2')])
    expect(String(out[1].content)).toBe('stop doing X')
  })

  test('an ordinary user message is untouched', async () => {
    const out = await seam([persistedRow('p', { role: 'user', content: 'hello' })])
    expect(String(out[0].content)).toBe('hello')
  })
})
