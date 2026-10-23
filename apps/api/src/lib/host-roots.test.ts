import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { localixHome } from './env'
import { computeHostRoots, hostRootContaining, hostRoots } from './host-roots'
import { isPathWithin } from './path-containment'

/**
 * The host roots decide what an agent may never touch, so both failure directions are pinned:
 * a layout that yields NO root leaves the application open, and a root that is too WIDE (the home
 * directory, `~/.localix`, `/`) would lock the agent out of its own world.
 */

const identity = (p: string): string => p
const HOME = '/home/ada'
const STATE = '/home/ada/.localix'
const roots = (moduleFile: string, home = HOME, state = STATE): string[] =>
  computeHostRoots({ moduleFile, home, localixHome: state, realpath: identity })

describe('computeHostRoots', () => {
  test('source layout: the checkout root, four levels above lib/', () => {
    expect(roots('/home/ada/code/localix/apps/api/src/lib/host-roots.ts')).toEqual([
      '/home/ada/code/localix',
    ])
  })

  test('desktop bundle: the staged resources dir and the resource dir holding it', () => {
    expect(roots('/usr/lib/Localix/resources/server.js')).toEqual([
      '/usr/lib/Localix/resources',
      '/usr/lib/Localix',
    ])
  })

  test('macOS: the whole .app bundle is the application', () => {
    expect(roots('/Applications/Localix.app/Contents/Resources/resources/server.js')).toEqual([
      '/Applications/Localix.app/Contents/Resources/resources',
      '/Applications/Localix.app/Contents/Resources',
      '/Applications/Localix.app',
    ])
  })

  test('CLI package under the home dir protects the package, never the home dir above it', () => {
    const found = roots('/home/ada/.bun/install/global/node_modules/localix/server/server.js')
    expect(found).toEqual([
      '/home/ada/.bun/install/global/node_modules/localix/server',
      '/home/ada/.bun/install/global/node_modules/localix',
    ])
  })

  test('an unknown container is not widened to its parent', () => {
    expect(roots('/opt/localix/server.js')).toEqual(['/opt/localix'])
    expect(roots('/srv/dist/server.js')).toEqual(['/srv/dist'])
  })

  test('never the home dir, never ~/.localix, never anything that swallows it', () => {
    expect(roots('/home/ada/server.js')).toEqual([])
    expect(roots('/home/ada/.localix/plugins/x/server.js')).toEqual([])
    // A checkout that CONTAINS the state dir (HOME pointed inside it) is not a host root.
    expect(
      roots('/work/repo/apps/api/src/lib/h.ts', '/work/repo/home', '/work/repo/home/.localix'),
    ).toEqual([])
  })

  test('a canonical spelling is kept beside the lexical one', () => {
    const found = computeHostRoots({
      moduleFile: '/link/app/resources/server.js',
      home: HOME,
      localixHome: STATE,
      realpath: (p) => p.replace('/link/', '/real/'),
    })
    expect(found).toContain('/link/app/resources')
    expect(found).toContain('/real/app/resources')
  })
})

describe('hostRoots (this process, running from source)', () => {
  const checkout = path.resolve(import.meta.dir, '../../../..')

  test('includes the checkout this test runs from', () => {
    expect(existsSync(path.join(checkout, 'apps', 'api', 'package.json'))).toBe(true)
    expect(hostRootContaining(path.join(checkout, 'apps/api/src/lib/env.ts'))).toBeDefined()
    expect(hostRootContaining(path.join(checkout, '.turbo/dev-mini-apps/1/x'))).toBeDefined()
  })

  test('never contains ~/.localix', () => {
    for (const root of hostRoots()) {
      expect(isPathWithin(root, localixHome())).toBe(false)
      expect(isPathWithin(localixHome(), root)).toBe(false)
    }
    expect(hostRootContaining(path.join(localixHome(), 'workspace', 'a.txt'))).toBeUndefined()
  })
})
