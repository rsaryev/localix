import { describe, expect, test } from 'bun:test'
import { touchesProject } from './changes'

describe('touchesProject', () => {
  const root = '/work/app'

  test('a source edit, a new folder and the coarse signal can move the map', () => {
    expect(touchesProject(root, ['/work/app/src', '/work/app/src/a.ts'])).toBe(true)
    expect(touchesProject(root, ['/work/app/lib'])).toBe(true)
    expect(touchesProject(root, null)).toBe(true)
  })

  // The tab hears `.git` too: re-indexing whenever a `git status` touched the index, or an install
  // churned dependencies, would walk the project for nothing.
  test('git state, dependencies and build output cannot', () => {
    expect(touchesProject(root, ['/work/app/.git', '/work/app/.git/index'])).toBe(false)
    expect(touchesProject(root, ['/work/app/node_modules/pkg/index.js'])).toBe(false)
    expect(touchesProject(root, ['/work/app/packages/ui/dist/main.js'])).toBe(false)
  })

  test('only the path below the root is judged; a symlinked spelling is kept', () => {
    expect(touchesProject('/home/build/app', ['/home/build/app/src/a.ts'])).toBe(true)
    expect(touchesProject(root, ['/private/work/app/src/a.ts'])).toBe(true)
  })

  test('Windows separators are compared like POSIX ones', () => {
    expect(touchesProject('C:\\work\\app', ['C:\\work\\app\\.git\\HEAD'])).toBe(false)
    expect(touchesProject('C:\\work\\app', ['C:\\work\\app\\src\\a.ts'])).toBe(true)
  })
})
