import { describe, expect, test } from 'bun:test'

import {
  contextBindingFilePath,
  contextBindingFileName,
  contextBindingFileType,
  contextBindingMediaId,
  contextBindingImageMimeType,
  contextBindingPreviewKind,
} from './binding-presentation'
import { createMessageBindingDraft } from './message-binding-drag'

describe('context binding presentation', () => {
  test('classifies image and text files from their canonical path', () => {
    const image = createMessageBindingDraft('file', '/workspace/Preview.PNG', 'Preview.PNG')
    const text = createMessageBindingDraft('file', '/workspace/readme.md', 'readme.md')

    expect(contextBindingFilePath(image)).toBe('/workspace/Preview.PNG')
    expect(contextBindingPreviewKind(image)).toBe('image')
    expect(contextBindingImageMimeType(image)).toBe('image/png')
    expect(contextBindingPreviewKind(text)).toBe('text')
  })

  test('leaves opaque resources and unsupported files without a preview', () => {
    const resource = createMessageBindingDraft(
      'resource',
      'localix://resource/example/42',
      'Example',
    )
    const archive = createMessageBindingDraft('file', '/workspace/archive.zip', 'archive.zip')

    expect(contextBindingFilePath(resource)).toBeNull()
    expect(contextBindingPreviewKind(resource)).toBeNull()
    expect(contextBindingPreviewKind(archive)).toBeNull()
  })

  test('presents media-backed files without treating their content id as a path', () => {
    const image = {
      kind: 'context' as const,
      source: 'drag' as const,
      target: {
        kind: 'file' as const,
        token: '@media:abc.png',
        label: 'clipboard.png',
        attributes: {
          mediaId: 'abc.png',
          name: 'clipboard.png',
          type: 'image/png',
          size: 12,
        },
      },
    }

    expect(contextBindingMediaId(image)).toBe('abc.png')
    expect(contextBindingFilePath(image)).toBeNull()
    expect(contextBindingFileName(image)).toBe('clipboard.png')
    expect(contextBindingFileType(image)).toBe('image/png')
    expect(contextBindingPreviewKind(image)).toBe('image')
    expect(contextBindingImageMimeType(image)).toBe('image/png')
  })
})
