import { expect, test } from 'bun:test'
import { editorSnapshotFor } from './fileEditorSnapshot'
import { readyStateFor } from './fileLoadState'

const disk = {
  path: '/workspace/file.ts',
  content: 'disk',
  bytes: 4,
  truncated: false,
  hash: 'new',
}

test('a legacy draft without a baseline keeps the current disk token', () => {
  expect(editorSnapshotFor(readyStateFor('file.ts', disk), 'draft')).toEqual({
    buffer: 'draft',
    baseContent: 'disk',
    baseHash: 'new',
    conflict: null,
  })
})

test('empty draft and baseline values survive without falling back to disk', () => {
  expect(
    editorSnapshotFor(readyStateFor('file.ts', disk), '', {
      content: '',
      baseContent: '',
      baseHash: '',
    }),
  ).toEqual({
    buffer: '',
    baseContent: '',
    baseHash: '',
    conflict: { diskContent: 'disk', diskHash: 'new' },
  })
})

test('a missing or noneditable file has no editable snapshot', () => {
  const empty = { buffer: '', baseContent: '', baseHash: '', conflict: null }
  expect(editorSnapshotFor(null)).toEqual(empty)
  expect(editorSnapshotFor(readyStateFor('file.ts', { ...disk, truncated: true }))).toEqual(empty)
  expect(editorSnapshotFor(readyStateFor('file.ts', { ...disk, hash: undefined }))).toEqual(empty)
})

test('an empty disk hash remains editable but does not announce a hash conflict', () => {
  expect(
    editorSnapshotFor(readyStateFor('file.ts', { ...disk, hash: '' }), 'draft', {
      content: 'draft',
      baseContent: 'old disk',
      baseHash: 'old',
    }),
  ).toEqual({ buffer: 'draft', baseContent: 'old disk', baseHash: 'old', conflict: null })
})
