import { describe, expect, test } from 'bun:test'
import type { MessageAttachment } from '@localixai/agent'

import {
  MEDIA_ATTACHMENT_IO_CONCURRENCY,
  rehydrateMediaAttachments,
  storeMediaAttachments,
} from './attachments'
import type { MediaStore } from './store'

/** A minimal in-memory store for the bridge tests (no filesystem). */
function fakeStore(): MediaStore & { written: Map<string, string> } {
  const written = new Map<string, string>()
  return {
    written,
    async putBase64(base64) {
      const id = `id-${written.size}.png`
      written.set(id, base64)
      return { id, size: Buffer.from(base64, 'base64').length }
    },
    async getBase64(id) {
      return written.get(id) ?? null
    },
    async putBytes(bytes, _mediaType) {
      const id = `id-${written.size}.png`
      written.set(id, Buffer.from(bytes).toString('base64'))
      return { id, size: bytes.byteLength }
    },
    async delete(id) {
      return written.delete(id)
    },
    async resolve() {
      return null
    },
  }
}

describe('storeMediaAttachments', () => {
  test('moves inline base64 to a file ref (mediaId, no data)', async () => {
    const store = fakeStore()
    const input: MessageAttachment[] = [
      {
        kind: 'image',
        mediaType: 'image/png',
        data: 'QUJD',
        name: 'a.png',
        size: 3,
      },
    ]
    const [out] = await storeMediaAttachments(store, input)
    expect(out.kind).toBe('image')
    if (out.kind === 'image') {
      expect(out.data).toBeUndefined()
      expect(out.mediaId).toBe('id-0.png')
      // Non-byte metadata is preserved.
      expect(out.name).toBe('a.png')
      expect(out.size).toBe(3)
    }
    expect(store.written.get('id-0.png')).toBe('QUJD')
  })

  test('leaves text attachments and already-filed refs alone', async () => {
    const store = fakeStore()
    const input: MessageAttachment[] = [
      { kind: 'text', name: 'n.txt', text: 'x', size: 1 },
      { kind: 'image', mediaType: 'image/png', mediaId: 'pre.png', name: 'b.png', size: 3 },
    ]
    const out = await storeMediaAttachments(store, input)
    expect(out).toEqual(input)
    expect(store.written.size).toBe(0)
  })

  test('no store → identity (legacy inline base64 kept)', async () => {
    const input: MessageAttachment[] = [
      { kind: 'image', mediaType: 'image/png', data: 'QUJD', name: 'a.png', size: 3 },
    ]
    expect(await storeMediaAttachments(undefined, input)).toEqual(input)
  })
})

describe('rehydrateMediaAttachments', () => {
  test('inlines bytes for a file ref (round-trips store → rehydrate)', async () => {
    const store = fakeStore()
    const [filed] = await storeMediaAttachments(store, [
      { kind: 'image', mediaType: 'image/png', data: 'QUJD', name: 'a.png', size: 3 },
    ])
    const [back] = await rehydrateMediaAttachments(store, [filed])
    if (back.kind === 'image') {
      expect(back.data).toBe('QUJD')
      expect(back.mediaId).toBe('id-0.png')
    }
  })

  test('back-compat: an inline-data attachment passes through untouched', async () => {
    const store = fakeStore()
    const input: MessageAttachment[] = [
      { kind: 'image', mediaType: 'image/png', data: 'OLDBASE64', name: 'old.png', size: 6 },
    ]
    expect(await rehydrateMediaAttachments(store, input)).toEqual(input)
  })

  test('missing file → passes through (no data added)', async () => {
    const store = fakeStore()
    const input: MessageAttachment[] = [
      { kind: 'image', mediaType: 'image/png', mediaId: 'gone.png', name: 'g.png', size: 3 },
    ]
    const [out] = await rehydrateMediaAttachments(store, input)
    if (out.kind === 'image') expect(out.data).toBeUndefined()
  })

  test('rehydrates only attachment kinds selected for the model wire', async () => {
    const store = fakeStore()
    store.written.set('image.png', 'UE5H')
    store.written.set('file.zip', 'WklQ')
    const input: MessageAttachment[] = [
      { kind: 'image', mediaType: 'image/png', mediaId: 'image.png', name: 'i.png', size: 3 },
      {
        kind: 'file',
        mediaType: 'application/zip',
        mediaId: 'file.zip',
        name: 'f.zip',
        size: 3,
      },
    ]

    const output = await rehydrateMediaAttachments(store, input, {
      shouldRehydrate: (attachment) => attachment.kind === 'image',
    })
    expect(output[0]).toMatchObject({ kind: 'image', data: 'UE5H' })
    expect(output[1]).toBe(input[1])
  })

  test('bounds concurrent store reads and preserves attachment order', async () => {
    let active = 0
    let peak = 0
    const store = fakeStore()
    store.getBase64 = async (id) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return `data:${id}`
    }
    const input: MessageAttachment[] = Array.from({ length: 30 }, (_, index) => ({
      kind: 'image',
      mediaType: 'image/png',
      mediaId: `id-${index}`,
      name: `${index}.png`,
      size: 3,
    }))

    const output = await rehydrateMediaAttachments(store, input)
    expect(peak).toBeLessThanOrEqual(MEDIA_ATTACHMENT_IO_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
    expect(output.flatMap((item) => (item.kind === 'image' ? [item.data] : []))).toEqual(
      Array.from({ length: 30 }, (_, index) => `data:id-${index}`),
    )
  })
})
