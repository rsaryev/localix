import { describe, expect, test } from 'bun:test'
import {
  attachmentManifestRows,
  manifestAssetSummary,
  manifestAssets,
} from './composerContextManifest'

/**
 * The manifest answers "what will this message carry". An upload that shows only as a
 * thumbnail, with no size and outside the count, was invisible to that question.
 */
describe('attachmentManifestRows', () => {
  test('describes each upload in the same shape a link row uses', () => {
    const rows = attachmentManifestRows([
      {
        id: 'a1',
        previewUrl: 'blob:preview',
        attachment: {
          kind: 'image',
          mediaType: 'image/png',
          name: 'screen.png',
          size: 2048,
          data: 'x',
        },
      },
      {
        id: 'a2',
        attachment: { kind: 'text', name: 'notes.md', text: 'hello', size: 5 },
      },
    ])

    expect(rows[0]).toEqual({
      key: 'a1',
      label: 'screen.png',
      source: 'Attached image',
      size: '2 KB',
      thumbnailUrl: 'blob:preview',
    })
    // A text attachment's size is a character count; reporting it as bytes would be a lie
    // for every non-ASCII document.
    expect(rows[1]?.size).toBe('5 chars')
    expect(rows[1]?.thumbnailUrl).toBeUndefined()
  })

  test('an upload with no preview still describes itself', () => {
    const rows = attachmentManifestRows([
      {
        id: 'v',
        attachment: { kind: 'audio', mediaType: 'audio/webm', name: 'note.webm', size: 0 },
      },
    ])
    expect(rows[0]?.source).toBe('Voice message')
    expect(rows[0]?.size).toBeUndefined()
  })
})

describe('manifestAssets', () => {
  test('a picked element’s screenshot becomes a viewable row asset, not a silent one', () => {
    const assets = manifestAssets([
      { kind: 'image', mediaType: 'image/jpeg', data: 'YWJj', name: 'pick.jpg', size: 1024 },
      { kind: 'text', name: 'dom.txt', text: 'x', size: 1 },
    ])

    expect(assets[0]?.imageUrl).toBe('data:image/jpeg;base64,YWJj')
    expect(assets[0]?.size).toBe('1 KB')
    // A non-image asset is still listed; it just has nothing to show.
    expect(assets[1]?.imageUrl).toBeUndefined()
    expect(manifestAssetSummary(assets)).toBe('1 image · 1 file')
  })

  test('no assets means no summary line at all', () => {
    expect(manifestAssetSummary(manifestAssets(undefined))).toBeUndefined()
  })
})
