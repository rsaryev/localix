import { expect, test } from 'bun:test'
import { workspacePathsTouch } from './file-resource-sync'

test('file invalidations match exact folders, contents, creation, ancestors and coarse recovery', () => {
  const prefix = '.localix/resumes'
  for (const paths of [
    null,
    ['/repo/.localix'],
    ['/repo/.localix/resumes'],
    ['/repo/.localix/resumes/id/resume.json'],
    ['C:\\repo\\.localix\\resumes\\id\\resume.json'],
  ])
    expect(workspacePathsTouch(paths, prefix)).toBe(true)
  for (const paths of [
    ['/repo/src/app.ts'],
    ['/repo/.localix/resumes-old/file'],
    ['/repo/.localix/api/requests.json'],
  ])
    expect(workspacePathsTouch(paths, prefix)).toBe(false)
})
