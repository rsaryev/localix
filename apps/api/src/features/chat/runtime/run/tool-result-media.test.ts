import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMediaStore } from '../../../media/store'
import { persistToolResultMedia } from './tool-result-media'

const dirs: string[] = []
afterAll(async () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'localix-tool-media-'))
  dirs.push(dir)
  return createMediaStore({ dir })
}

const PNG = Buffer.from('fake-png-bytes').toString('base64')
// The shape a screenshot's end event carries after the tool bridge: the label, then the picture.
const screenshot = {
  content: 'Screenshot of button (4×4).[image]',
  contentParts: [
    { type: 'text' as const, text: 'Screenshot of button (4×4).' },
    { type: 'image' as const, mediaType: 'image/png' as const, data: PNG },
  ],
}

test('a returned image is stored as media and the item keeps its label, not `[image]`', async () => {
  // The defect: the item kept only `[image]`, so the next turn and the card had no picture.
  const media = await store()
  const kept = await persistToolResultMedia(screenshot, media)
  expect(kept.resultText).toBe('Screenshot of button (4×4).')
  expect(kept.attachments).toHaveLength(1)
  const [att] = kept.attachments!
  expect(att).toMatchObject({ kind: 'image', mediaType: 'image/png' })
  expect(att!.data).toBeUndefined() // never megabytes of base64 in the row
  expect(await media.getBase64(att!.mediaId!)).toBe(PNG) // the bytes are on disk
})

test('a text-only result, or no media store, keeps the old text shape', async () => {
  expect(await persistToolResultMedia({ content: 'ok' }, await store())).toEqual({
    resultText: 'ok',
  })
  // Nowhere durable for the bytes, and inlining them is what this exists to avoid.
  expect(await persistToolResultMedia(screenshot, undefined)).toEqual({
    resultText: screenshot.content,
  })
})
