import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolBackedItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../../db/payload'
import { createMediaStore } from '../../../../media/store'
import { rehydrateToolImages } from './tool-images'

const dirs: string[] = []
afterAll(async () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'localix-tool-images-'))
  dirs.push(dir)
  const mediaStore = createMediaStore({ dir })
  const shot = async (id: string, bytes: string) => {
    const { id: mediaId } = await mediaStore.putBase64(bytes, 'image/png')
    return {
      id,
      type: 'tool_call',
      status: 'completed',
      toolCallId: id,
      name: 'Browser',
      activeVerb: 'Controlling browser',
      resultText: `Screenshot ${id}`,
      supersedeKey: 'browser:screenshot',
      attachments: [{ kind: 'image', mediaType: 'image/png', mediaId, name: 'image-1', size: 1 }],
    } as ToolBackedItem
  }
  const payloads = [
    { id: 'm-old', role: 'assistant', items: [await shot('old', 'T0xE')] },
    { id: 'm-new', role: 'assistant', items: [await shot('new', 'TkVX')] },
  ] as unknown as StoredMessagePayload[]
  return { mediaStore, payloads }
}

const dataOf = (payload: StoredMessagePayload) =>
  (payload.items?.[0] as ToolBackedItem | undefined)?.attachments?.[0]?.data

// Append-only between checkpoints: the arrival of a newer snapshot must not rewrite the older
// one the model already saw, so both keep their pictures until a checkpoint collapses one.
test('a superseded screenshot keeps its bytes until a checkpoint collapses it', async () => {
  const { mediaStore, payloads } = await fixture()
  const out = await rehydrateToolImages(payloads, { mediaStore, acceptsImages: true })
  expect(dataOf(out[0]!)).toBe('T0xE')
  expect(dataOf(out[1]!)).toBe('TkVX')
})

test('a result the checkpoint collapsed is not read; untouched rows are the same objects', async () => {
  const { mediaStore, payloads } = await fixture()
  const out = await rehydrateToolImages(payloads, {
    mediaStore,
    acceptsImages: true,
    collapsed: (messageId, toolCallId) => messageId === 'm-old' && toolCallId === 'old',
  })
  expect(dataOf(out[1]!)).toBe('TkVX')
  expect(dataOf(out[0]!)).toBeUndefined()
  expect(out[0]).toBe(payloads[0])
})

test('a model that cannot read images is sent no image bytes', async () => {
  // The provider rejects an image for a text-only model; the SDK names the absence instead.
  const { mediaStore, payloads } = await fixture()
  expect(await rehydrateToolImages(payloads, { mediaStore, acceptsImages: false })).toBe(payloads)
})
