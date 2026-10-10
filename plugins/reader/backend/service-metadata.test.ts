import { expect, test } from 'bun:test'

import { ReaderService } from './service'

async function openedBook(): Promise<ReaderService> {
  const service = new ReaderService({
    media: {
      async getBytes() {
        return new TextEncoder().encode(
          '<FictionBook><description><title-info><book-title>Source</book-title>' +
            '<author><first-name>Original</first-name><last-name>Author</last-name></author>' +
            '</title-info></description><body><section><p>Body</p></section></body></FictionBook>',
        )
      },
      async putBytes() {
        throw new Error('Metadata edits must not upload bytes')
      },
    },
  })
  await service.readMedia('book', 'source.fb2')
  return service
}

test('empty author hides the source author and null restores it without changing prior records', async () => {
  const service = await openedBook()
  const source = { mediaId: 'book' }
  const original = (await service.list()).books[0]!
  expect(original.author).toBe('Original Author')
  const patch = Object.freeze({ title: '  Custom\n title  ', author: '\t ' })
  const edited = await service.updateMetadata('', source, patch)
  expect(edited.title).toBe('Custom title')
  expect(edited.author).toBeUndefined()
  expect(edited.overrides).toEqual({ title: 'Custom title', author: '' })
  expect(edited.sourceAuthor).toBe('Original Author')
  const reset = await service.updateMetadata('', source, { title: null, author: null })
  expect(reset.title).toBe('Source')
  expect(reset.author).toBe('Original Author')
  expect(reset.overrides).toBeUndefined()
  expect(original.title).toBe('Source')
  expect(original.overrides).toBeUndefined()
  expect(edited.overrides).toEqual({ title: 'Custom title', author: '' })
  expect(patch.title).toBe('  Custom\n title  ')
})

test('metadata length is checked after whitespace normalization and a failed patch stays atomic', async () => {
  const service = await openedBook()
  const source = { mediaId: 'book' }
  const title = 'a'.repeat(300)
  const accepted = await service.updateMetadata('', source, { title: ` \n${title}\t ` })
  expect(accepted.title).toBe(title)
  await expect(
    service.updateMetadata('', source, { title: 'Valid replacement', author: 'a'.repeat(301) }),
  ).rejects.toThrow('Author must be 300 characters or fewer')
  expect((await service.list()).books[0]).toBe(accepted)
})

test('collection names normalize whitespace and reject oversized renames without changing the shelf', async () => {
  const service = new ReaderService()
  const name = 'a'.repeat(80)
  const collection = await service.createCollection(` \n${name}\t `)
  expect(collection.name).toBe(name)
  await expect(service.renameCollection(collection.id, 'a'.repeat(81))).rejects.toThrow(
    'Collection name must be 80 characters or fewer',
  )
  await expect(service.renameCollection(collection.id, '\t ')).rejects.toThrow(
    'Collection name cannot be empty',
  )
  expect((await service.list()).collections).toEqual([collection])
  expect((await service.renameCollection(collection.id, name.toUpperCase())).name).toBe(
    name.toUpperCase(),
  )
})
