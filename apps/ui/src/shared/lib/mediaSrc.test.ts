import { describe, expect, test } from 'bun:test'
import { mediaSrc, resolveMediaPath } from './mediaSrc'
import { API_BASE_URL } from '@/shared/api/internal'

describe('mediaSrc', () => {
  test('file-backed media resolves to the API media route', () => {
    expect(mediaSrc({ mediaType: 'image/png', mediaId: 'abc' })).toBe(
      `${API_BASE_URL}/rpc/media/abc`,
    )
  })

  test('mediaId takes precedence over legacy inline data', () => {
    expect(mediaSrc({ mediaType: 'image/png', mediaId: 'abc', data: 'AAAA' })).toBe(
      `${API_BASE_URL}/rpc/media/abc`,
    )
  })

  test('keeps an opaque media id inside one route segment', () => {
    expect(mediaSrc({ mediaType: 'image/png', mediaId: '../private image.png' })).toBe(
      'http://localhost:5050/rpc/media/..%2Fprivate%20image.png',
    )
  })

  test('legacy inline data renders as a typed data URL (back-compat)', () => {
    expect(mediaSrc({ mediaType: 'image/jpeg', data: 'AAAA' })).toBe('data:image/jpeg;base64,AAAA')
  })

  test('an attachment with neither id nor data yields an empty src', () => {
    expect(mediaSrc({ mediaType: 'image/png' })).toBe('')
  })
})

describe('resolveMediaPath', () => {
  test('a relative /rpc/media/ path is resolved against the API origin', () => {
    expect(resolveMediaPath('/rpc/media/xyz')).toBe(`${API_BASE_URL}/rpc/media/xyz`)
  })

  test('data URLs and absolute URLs pass through unchanged', () => {
    expect(resolveMediaPath('data:image/png;base64,zzz')).toBe('data:image/png;base64,zzz')
    expect(resolveMediaPath('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  test('an unrelated relative path is left alone (only /rpc/media/ is rewritten)', () => {
    expect(resolveMediaPath('/other/path.png')).toBe('/other/path.png')
  })
})
