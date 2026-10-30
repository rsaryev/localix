import { describe, expect, test } from 'bun:test'

import { readCuration } from './curation'

describe("a marketplace keeper's curation of one entry", () => {
  test('reads as the keeper wrote it', () => {
    expect(
      readCuration({
        featured: true,
        installByDefault: true,
        suggestFor: { files: ['*.sql', 'compose.yaml'], dependencies: ['pg'] },
      }),
    ).toEqual({
      featured: true,
      installByDefault: true,
      suggestFor: { files: ['*.sql', 'compose.yaml'], dependencies: ['pg'] },
    })
  })

  test('a pick that does not read is dropped alone, the rest kept', () => {
    expect(
      readCuration({
        featured: 'yes',
        installByDefault: true,
        suggestFor: { files: [1, '*.tf', ''], dependencies: 'pg' },
      }),
    ).toEqual({ installByDefault: true, suggestFor: { files: ['*.tf'] } })
  })

  test('false and a suggestion that names nothing say nothing', () => {
    expect(readCuration({ featured: false, suggestFor: { files: [] } })).toEqual({})
  })

  test('anything that is not an object is no curation', () => {
    expect(readCuration(undefined)).toEqual({})
    expect(readCuration('featured')).toEqual({})
    expect(readCuration([true])).toEqual({})
  })
})
