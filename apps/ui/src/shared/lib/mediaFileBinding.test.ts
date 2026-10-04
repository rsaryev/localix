import { describe, expect, test } from 'bun:test'

import { mediaFileBinding } from './mediaFileBinding'

describe('mediaFileBinding', () => {
  test('keeps browser bytes addressable without inventing a filesystem path', () => {
    const binding = mediaFileBinding({
      id: 'sha-256.png',
      name: 'clipboard image.png',
      size: 42,
      mediaType: 'image/png',
    })

    expect(binding).toEqual({
      kind: 'image',
      mediaType: 'image/png',
      mediaId: 'sha-256.png',
      name: 'clipboard image.png',
      size: 42,
    })
  })
})
