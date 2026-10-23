import { describe, expect, it } from 'bun:test'

import manifest from '../mini-app.json'
import {
  READER_EXTENSIONS,
  isReaderReadable,
  readerExtension,
  readerFileName,
  readerFormatFor,
  readerUnsupportedReason,
} from './formats'

describe('reader formats', () => {
  it('resolves a format per accepted extension, case- and path-insensitively', () => {
    expect(readerFormatFor('/books/Dune.EPUB')).toBe('epub')
    expect(readerFormatFor('C:\\books\\notes.markdown')).toBe('md')
    expect(readerFormatFor('page.htm')).toBe('html')
    for (const extension of READER_EXTENSIONS) {
      expect(readerFormatFor(`/books/sample.${extension}`)).not.toBeNull()
    }
  })

  it('refuses everything the reader cannot parse', () => {
    expect(readerFormatFor('/pictures/screenshot.png')).toBeNull()
    expect(isReaderReadable('/pictures/screenshot.png')).toBe(false)
    expect(readerExtension('/home/user/.bashrc')).toBe('')
    expect(readerExtension('/home/user/README')).toBe('')
  })

  it('explains a refusal with the extension and the supported list', () => {
    const reason = readerUnsupportedReason({ path: '/pictures/screenshot.png' })
    expect(reason).toContain('.png is not a reading format')
    expect(reason).toContain('EPUB')
    expect(readerUnsupportedReason({ path: '/books/Dune.epub' })).toBeNull()
  })

  it('lets a nameless media source through — only the backend can judge it', () => {
    expect(readerUnsupportedReason({ mediaId: 'abc' })).toBeNull()
    expect(readerUnsupportedReason({ mediaId: 'abc', name: 'shot.png' })).toContain('.png')
    expect(readerFileName({ path: '/books/sub/Dune.epub' })).toBe('Dune.epub')
  })

  it('matches the manifest file associations', () => {
    const declared = new Set(
      manifest.fileAssociations.flatMap((association) =>
        association.ext.map((extension) => extension.toLowerCase()),
      ),
    )
    expect([...declared].sort()).toEqual([...READER_EXTENSIONS].sort())
  })
})
