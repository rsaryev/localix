import { expect, test } from 'bun:test'

import { ReaderService } from './service'

test('cached media opens retain overrides and collections while preserving cached size policy', async () => {
  const bytes = new TextEncoder().encode('# Source title\n\nOriginal body.')
  let reads = 0
  const service = new ReaderService({
    media: {
      async getBytes() {
        reads += 1
        return bytes
      },
      async putBytes() {
        throw new Error('Reading must not upload bytes')
      },
    },
  })
  const source = { mediaId: 'book' }
  const parsed = await service.readMedia('book', ' source.md ')
  expect((await service.list()).books[0]?.size).toBe(bytes.byteLength)
  const collection = await service.createCollection('Shelf')
  await service.setCollections('', [source], [collection.id])
  await service.updateMetadata('', source, { title: 'Custom title', author: '' })

  expect(await service.readMedia('book', 'renamed.md', { remember: false })).toBe(parsed)
  expect((await service.list()).books[0]?.path).toBe('source.md')
  expect(await service.readMedia('book', ' renamed.md ')).toBe(parsed)
  const remembered = (await service.list()).books[0]!
  expect(remembered).toMatchObject({
    path: 'renamed.md',
    mediaId: 'book',
    title: 'Custom title',
    sourceTitle: 'Source title',
    overrides: { title: 'Custom title', author: '' },
    collectionIds: [collection.id],
    size: 0,
  })
  expect(Object.hasOwn(remembered, 'author')).toBe(false)
  expect(reads).toBe(1)
  const reset = await service.updateMetadata('', source, { title: null, author: null })
  expect(reset.title).toBe('Source title')
  expect(reset.overrides).toBeUndefined()
})

test('invalid metadata edits leave the explicit book unchanged', async () => {
  const service = new ReaderService({
    media: {
      async getBytes() {
        return new TextEncoder().encode('# Source')
      },
      async putBytes() {
        throw new Error('Reading must not upload bytes')
      },
    },
  })
  await service.readMedia('book', 'source.md')
  const before = (await service.list()).books[0]
  await expect(service.updateMetadata('', { mediaId: 'book' }, { title: ' ' })).rejects.toThrow(
    'Title cannot be empty',
  )
  await expect(
    service.updateMetadata('', { mediaId: 'book' }, { author: 'a'.repeat(301) }),
  ).rejects.toThrow('Author must be 300 characters or fewer')
  expect((await service.list()).books[0]).toBe(before)
})
