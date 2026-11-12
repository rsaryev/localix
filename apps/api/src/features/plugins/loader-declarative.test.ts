import { describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { modRevision } from './loader-declarative'

const dir = tempDirPerTest('mod-revision-', {
  'hooks/register.js': 'export function register() {}',
  'types/index.d.ts': "declare module 'claude-code' { interface PluginState {} }",
})

const later = (path: string) => utimesSync(path, new Date(4e12), new Date(4e12))

describe('modRevision', () => {
  test('a changed types file is a new revision: the loader checks the module against it', async () => {
    const files = {
      module: join(dir(), 'hooks/register.js'),
      types: join(dir(), 'types/index.d.ts'),
    }
    const before = await modRevision(files, {})
    later(files.types)
    expect(await modRevision(files, {})).not.toBe(before)
  })

  test('a changed module or option is a new revision; the same files and options are not', async () => {
    const files = {
      module: join(dir(), 'hooks/register.js'),
      types: join(dir(), 'types/index.d.ts'),
    }
    const before = await modRevision(files, { a: 1 })
    expect(await modRevision(files, { a: 1 })).toBe(before)
    expect(await modRevision(files, { a: 2 })).not.toBe(before)
    later(files.module)
    expect(await modRevision(files, { a: 1 })).not.toBe(before)
  })

  test('a link back to its own folder is not entered, and a file in a subfolder still counts', async () => {
    const hooks = join(dir(), 'hooks')
    symlinkSync('.', join(hooks, 'self'))
    mkdirSync(join(hooks, 'lib'))
    writeFileSync(join(hooks, 'lib/util.js'), 'export const one = 1')
    const files = { module: join(hooks, 'register.js') }
    const before = await modRevision(files, {})
    later(join(hooks, 'lib/util.js'))
    expect(await modRevision(files, {})).not.toBe(before)
  })
})
