import { describe, expect, test } from 'bun:test'

import { BUILTIN_EDITOR_CHOICE } from '@/shared/contrib/fileEditorChoice'

import { hasNativeFileViewer, initialFileEditorSelection } from './fileEditorSelection'

describe('file editor selection', () => {
  test('opens one contributed editor directly when core has no native viewer', () => {
    expect(initialFileEditorSelection(['example:book'], null, false)).toBe('example:book')
  })

  test('offers Open with when a mini app and the native image viewer both match', () => {
    expect(hasNativeFileViewer('cover.PNG')).toBe(true)
    expect(initialFileEditorSelection(['image-mini-app:editor'], null, true)).toBeNull()
  })

  test('offers Open with when Reader and the native text editor both match', () => {
    expect(hasNativeFileViewer('manual.markdown')).toBe(true)
    expect(initialFileEditorSelection(['example:text-view'], null, true)).toBeNull()
  })

  test('offers Open with when two mini apps match the same file', () => {
    expect(initialFileEditorSelection(['alpha:editor', 'beta:editor'], null, false)).toBeNull()
  })

  test('honors remembered native and mini app choices', () => {
    expect(initialFileEditorSelection(['image-mini-app:editor'], BUILTIN_EDITOR_CHOICE, true)).toBe(
      BUILTIN_EDITOR_CHOICE,
    )
    expect(initialFileEditorSelection(['alpha:editor', 'beta:editor'], 'beta:editor', false)).toBe(
      'beta:editor',
    )
  })

  test('ignores a stale remembered mini app', () => {
    expect(initialFileEditorSelection(['example:book'], 'removed:editor', false)).toBe(
      'example:book',
    )
  })
})

describe('a preferred editor opens without the chooser', () => {
  const pdf = ['example:pdf', 'other:book']
  const preferred = ['example:pdf']

  test('the preferred PDF viewer opens directly when Reader also matches', () => {
    expect(initialFileEditorSelection(pdf, null, false, false, preferred)).toBe('example:pdf')
  })

  test('a remembered Reader choice still wins over the preferred editor', () => {
    expect(initialFileEditorSelection(pdf, 'other:book', false, false, preferred)).toBe(
      'other:book',
    )
  })

  test('without a preferred match, or with two, the chooser shows', () => {
    expect(initialFileEditorSelection(pdf, null, false)).toBeNull()
    expect(initialFileEditorSelection(pdf, null, false, false, pdf)).toBeNull()
  })

  test('a meaningful native viewer still asks first', () => {
    expect(
      initialFileEditorSelection(['mini-app:md'], null, true, false, ['mini-app:md']),
    ).toBeNull()
  })
})

describe('an open that asks for the code editor', () => {
  test('gets it even when a mini app owns the file type', () => {
    // The case that made a button look dead: a mini app registers an editor for a compound
    // `.scene.json` type, so asking to open the file itself rendered the mini app surface again.
    expect(initialFileEditorSelection(['example:scene-file'], null, false, true)).toBe(
      BUILTIN_EDITOR_CHOICE,
    )
  })

  test('gets it without being asked to choose', () => {
    // `.scene.json` ends in `json`, which the built-in text surface also claims — so this file
    // hit the "Open with" chooser rather than opening. An explicit request answers it.
    expect(hasNativeFileViewer('example.scene.json')).toBe(true)
    expect(initialFileEditorSelection(['example:scene-file'], null, true)).toBeNull()
    expect(initialFileEditorSelection(['example:scene-file'], null, true, true)).toBe(
      BUILTIN_EDITOR_CHOICE,
    )
  })

  test('outranks a remembered mini app preference', () => {
    // A remembered choice answers "what does this reader usually want"; the request answers
    // "what did this open ask for", and only the second one knows.
    expect(initialFileEditorSelection(['example:book'], 'example:book', false, true)).toBe(
      BUILTIN_EDITOR_CHOICE,
    )
  })

  test('absent, nothing changes', () => {
    expect(initialFileEditorSelection(['example:book'], null, false)).toBe('example:book')
    expect(initialFileEditorSelection(['example:book'], null, false, false)).toBe('example:book')
  })
})
