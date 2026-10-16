import { describe, expect, test } from 'bun:test'

import {
  BINARY_SNIFF_LENGTH,
  fileExtension,
  hasBinarySignature,
  mediaTypeForExtension,
  mediaTypeForPath,
  mediaTypesFor,
} from './media-types'

describe('media type vocabulary', () => {
  test('resolves an extension however it is spelled', () => {
    expect(mediaTypeForExtension('JPG')).toBe('image/jpeg')
    expect(mediaTypeForExtension('.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(mediaTypeForPath('C:\\shots\\Screen.PNG')).toBe('image/png')
    expect(mediaTypeForPath('/no/extension')).toBeUndefined()
    // An object-prototype key is not a format.
    expect(mediaTypeForExtension('constructor')).toBeUndefined()
    expect(fileExtension('.bashrc')).toBe('')
  })

  test('builds a dot-keyed allowlist and refuses a format nobody defined', () => {
    expect(mediaTypesFor(['png', 'pdf'])).toEqual({
      '.png': 'image/png',
      '.pdf': 'application/pdf',
    })
    expect(() => mediaTypesFor(['nope'])).toThrow(/No media type/)
  })
})

describe('hasBinarySignature', () => {
  test('reads a NUL in the sniff window of text or bytes', () => {
    expect(hasBinarySignature('abc\u0000def')).toBe(true)
    expect(hasBinarySignature(new Uint8Array([104, 0, 105]))).toBe(true)
    expect(hasBinarySignature('plain text ✓')).toBe(false)
  })

  // The `@file` reference expander sniffed 8192 bytes while `read` sniffed 8000 chars, so a NUL
  // between the two made one file binary to one reader and text to the other.
  test('applies one window to every reader', () => {
    const late = 'a'.repeat(BINARY_SNIFF_LENGTH) + '\u0000'
    expect(hasBinarySignature(late)).toBe(false)
    expect(hasBinarySignature(new TextEncoder().encode(late))).toBe(false)
  })
})
