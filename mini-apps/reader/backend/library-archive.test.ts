import { expect, test } from 'bun:test'
import { zipSync } from 'fflate'
import { parseReaderBytes } from './library'

test.each(['epub', 'cbz'] as const)(
  '%s preserves a readable error for malformed archives',
  async (format) => {
    await expect(
      parseReaderBytes(`broken.${format}`, new Uint8Array([1, 2, 3])),
    ).rejects.toMatchObject({
      message: `This ${format.toUpperCase()} is not a readable archive.`,
      cause: expect.any(Error),
    })
  },
)

test.each(['epub', 'cbz'] as const)('%s rejects archives above the entry limit', async (format) => {
  const entries = Object.fromEntries(
    Array.from({ length: 3_001 }, (_, i) => [`entry-${i}`, new Uint8Array()]),
  )
  await expect(parseReaderBytes(`oversized.${format}`, zipSync(entries))).rejects.toMatchObject({
    message: `${format.toUpperCase()} has too many archive entries`,
  })
})

test('CBZ ignores macOS metadata when counting archive entries', async () => {
  const entries = Object.fromEntries(
    Array.from({ length: 3_001 }, (_, i) => [`__MACOSX/entry-${i}`, new Uint8Array()]),
  )
  const parsed = await parseReaderBytes(
    'pages.cbz',
    zipSync({ ...entries, 'page.png': new Uint8Array([137, 80, 78, 71]) }),
  )
  expect(parsed.chapters).toHaveLength(1)
  expect(parsed.document.format).toBe('cbz')
})
