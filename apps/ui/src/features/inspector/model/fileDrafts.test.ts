import { describe, expect, test } from 'bun:test'
import { clearFileDraft, fileEditorOwnerKey, getFileDraft, setFileDraft } from './fileDrafts'

describe('file draft ownership', () => {
  test('keeps drafts for the same absolute path isolated by session', () => {
    const path = '/workspace/shared.ts'
    setFileDraft('session-a', path, 'draft from A')
    setFileDraft('session-b', path, 'draft from B')

    expect(getFileDraft('session-a', path)).toBe('draft from A')
    expect(getFileDraft('session-b', path)).toBe('draft from B')

    clearFileDraft('session-a', path)
    expect(getFileDraft('session-a', path)).toBeUndefined()
    expect(getFileDraft('session-b', path)).toBe('draft from B')
    clearFileDraft('session-b', path)
  })

  test('owner keys cannot collide across session/path boundaries', () => {
    expect(fileEditorOwnerKey('a', 'b/c')).not.toBe(fileEditorOwnerKey('a/b', 'c'))
  })
})
