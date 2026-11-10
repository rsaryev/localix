import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { diskStagedDirectory } from './staged-directory'

const dir = tempDirPerTest('kit-staged')
const signal = new AbortController().signal
const plan = (extra: object) => ({
  copy: [],
  relinks: [],
  dereferences: [],
  skipped: [],
  refusals: [],
  ...extra,
})

describe('a staged plugin directory moved into the cache', () => {
  test('opens a staged directory for reading, and removes it', async () => {
    writeTree(dir(), { 'stage/.claude-plugin/plugin.json': '{}' })
    const files = await diskStagedDirectory.open(join(dir(), 'stage'), signal)
    expect(await files?.exists('.claude-plugin/plugin.json')).toBe(true)
    expect(await diskStagedDirectory.open(join(dir(), 'none'), signal)).toBeUndefined()
    expect(await diskStagedDirectory.remove(join(dir(), 'stage'), signal)).toBeUndefined()
    expect(await diskStagedDirectory.remove(join(dir(), 'stage'), signal)).toBeUndefined()
    expect(existsSync(join(dir(), 'stage'))).toBe(false)
  })

  test('moves a directory with no link whole, in place of an earlier copy', async () => {
    writeTree(dir(), { 'stage/a.md': 'new', 'cache/demo/1.0.0/a.md': 'old' })
    const destination = join(dir(), 'cache/demo/1.0.0')
    const stagedPath = join(dir(), 'stage')
    expect(await diskStagedDirectory.commit({ stagedPath, destination }, signal)).toBeUndefined()
    expect(readFileSync(join(destination, 'a.md'), 'utf8')).toBe('new')
    expect(readdirSync(join(dir(), 'cache/demo'))).toEqual(['1.0.0'])
  })

  test('materializes a plan: copies, relinks, dereferences, and leaves the skipped out', async () => {
    writeTree(dir(), {
      'market/shared/lib.md': 'shared',
      'stage/skills/a/SKILL.md': '# A',
      'stage/notes.md': 'notes',
    })
    symlinkSync('skills/a', join(dir(), 'stage/alias'))
    symlinkSync(join(dir(), 'market/shared'), join(dir(), 'stage/shared'))
    symlinkSync('/nowhere', join(dir(), 'stage/outside'))
    const destination = join(dir(), 'cache/demo/2.0.0')
    const committed = await diskStagedDirectory.commit(
      {
        stagedPath: join(dir(), 'stage'),
        destination,
        plan: plan({
          copy: ['skills', 'skills/a', 'skills/a/SKILL.md', 'notes.md'],
          relinks: [{ path: 'alias', target: 'skills/a' }],
          dereferences: [{ path: 'shared', from: join(dir(), 'market/shared'), isDirectory: true }],
          skipped: [{ path: 'outside', reason: 'outside-marketplace' }],
        }),
      },
      signal,
    )
    expect(committed).toBeUndefined()
    expect(readFileSync(join(destination, 'skills/a/SKILL.md'), 'utf8')).toBe('# A')
    expect(readlinkSync(join(destination, 'alias'))).toBe('skills/a')
    expect(lstatSync(join(destination, 'shared')).isDirectory()).toBe(true)
    expect(readFileSync(join(destination, 'shared/lib.md'), 'utf8')).toBe('shared')
    expect(existsSync(join(destination, 'outside'))).toBe(false)
  })

  test('a move that fails puts the earlier copy back and says so', async () => {
    writeTree(dir(), { 'cache/demo/1.0.0/a.md': 'old' })
    const destination = join(dir(), 'cache/demo/1.0.0')
    const failed = await diskStagedDirectory.commit(
      { stagedPath: join(dir(), 'gone'), destination },
      signal,
    )
    expect(failed).toMatchObject({ failure: 'busy', code: 'ENOENT', previous: 'moved-back' })
    expect(readFileSync(join(destination, 'a.md'), 'utf8')).toBe('old')
    expect(readdirSync(join(dir(), 'cache/demo'))).toEqual(['1.0.0'])
  })

  test('a staged path that cannot be removed is a failure', async () => {
    const refused = await diskStagedDirectory.remove(join(dir(), 'bad\u0000name'), signal)
    expect(refused).toMatchObject({ failure: 'remove' })
  })

  test('a cancelled install moves nothing', async () => {
    writeTree(dir(), { 'stage/a.md': 'new' })
    const destination = join(dir(), 'cache/demo/1.0.0')
    const stopped = await diskStagedDirectory.commit(
      { stagedPath: join(dir(), 'stage'), destination },
      AbortSignal.abort(),
    )
    expect(stopped).toMatchObject({ failure: 'aborted', previous: 'none' })
    expect(existsSync(destination)).toBe(false)
  })
})
