import { expect, test } from 'bun:test'
import { workspacePathsTouch } from './file-resource-sync'

test('file invalidations match exact folders, contents, creation, ancestors and coarse recovery', () => {
  const prefix = '.localix/notes'
  for (const paths of [
    null,
    ['/repo/.localix'],
    ['/repo/.localix/notes'],
    ['/repo/.localix/notes/id/note.json'],
    ['C:\\repo\\.localix\\notes\\id\\note.json'],
  ])
    expect(workspacePathsTouch(paths, prefix)).toBe(true)
  for (const paths of [
    ['/repo/src/app.ts'],
    ['/repo/.localix/notes-old/file'],
    ['/repo/.localix/other/requests.json'],
  ])
    expect(workspacePathsTouch(paths, prefix)).toBe(false)
})
