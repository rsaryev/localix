import { describe, expect, test } from 'bun:test'

import { displayPath, pathGrants } from './permission-grant-paths'

const bounds = { protectedRoots: ['/home/me', '/home/me/.localix'], home: '/home/me' }

describe('the folder levels a path card offers', () => {
  test('the file first, then each folder above it, nearest first', () => {
    const grants = pathGrants('Read', ['/home/me/code/other/src/hooks/useTheme.ts'], bounds)
    expect(grants.map((g) => [g.kind, g.label, g.covers])).toEqual([
      ['path', 'useTheme.ts', '~/code/other/src/hooks/useTheme.ts'],
      ['folder', 'hooks', 'anything inside ~/code/other/src/hooks'],
      ['folder', 'src', 'anything inside ~/code/other/src'],
      ['folder', 'other', 'anything inside ~/code/other'],
      ['folder', 'code', 'anything inside ~/code'],
    ])
    expect(grants[2]).toMatchObject({
      scope: 'Read(/home/me/code/other/src/*)',
      rule: { action: 'tool:Read', resource: '/home/me/code/other/src/*' },
    })
    // Each level names its path, which is what the card's breadcrumb segments match.
    expect(grants.map((g) => g.target)).toEqual([
      '/home/me/code/other/src/hooks/useTheme.ts',
      '/home/me/code/other/src/hooks',
      '/home/me/code/other/src',
      '/home/me/code/other',
      '/home/me/code',
    ])
  })

  test('the walk stops before the home directory — `~` is every credential the user owns', () => {
    const labels = pathGrants('Read', ['/home/me/notes.md'], bounds).map((g) => g.label)
    expect(labels).toEqual(['notes.md'])
  })

  test('nor does it reach a folder that contains Localix state or the filesystem root', () => {
    const grants = pathGrants('Read', ['/srv/data/x.csv'], {
      protectedRoots: ['/srv/data/.localix'],
    })
    // `/srv/data` holds the state dir, so it and everything above it are withheld.
    expect(grants.map((g) => g.label)).toEqual(['x.csv'])
    expect(pathGrants('Read', ['/etc/hosts'], { protectedRoots: [] }).map((g) => g.label)).toEqual([
      'hosts',
      'etc',
    ])
  })

  test('several paths share the folders they all sit in, with no single-file option', () => {
    const grants = pathGrants('Read', ['/opt/app/src/a.ts', '/opt/app/test/b.ts'], bounds)
    expect(grants.map((g) => g.label)).toEqual(['app', 'opt'])
  })

  test('a credential, a relative path or a glob character offers no widening at all', () => {
    expect(pathGrants('Read', ['/home/me/code/.env'], bounds)).toEqual([])
    expect(pathGrants('Read', ['src/a.ts'], bounds)).toEqual([])
    expect(pathGrants('Read', ['/home/me/code/*.ts'], bounds)).toEqual([])
  })

  test('at most six folders, the nearest ones', () => {
    const deep = '/a/b/c/d/e/f/g/h/i/file.txt'
    const folders = pathGrants('Read', [deep], { protectedRoots: [] }).filter(
      (g) => g.kind === 'folder',
    )
    expect(folders.map((g) => g.label)).toEqual(['i', 'h', 'g', 'f', 'e', 'd'])
  })
})

test('the home prefix is shown as ~, and only a real prefix', () => {
  expect(displayPath('/home/me/code', '/home/me')).toBe('~/code')
  expect(displayPath('/home/me', '/home/me')).toBe('~')
  expect(displayPath('/home/meg/code', '/home/me')).toBe('/home/meg/code')
})
