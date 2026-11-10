import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { claudeTrust, realPathResolver, sessionEnvFiles } from './session-files'

const dir = tempDirPerTest('kit-session-files')
const signal = new AbortController().signal

describe('workspace trust, as Claude Code records it', () => {
  test('trusts exactly the folders whose trust dialog was accepted', async () => {
    writeFileSync(
      join(dir(), '.claude.json'),
      JSON.stringify({
        projects: { '/work/app': { hasTrustDialogAccepted: true }, '/work/other': {} },
      }),
    )
    const trust = claudeTrust({ homeDir: dir(), env: () => ({}) })
    expect(await trust.isFolderTrusted('/work/app')).toBe(true)
    expect(await trust.isFolderTrusted('/work/other')).toBe(false)
    expect(await trust.isFolderTrusted('/work/app/sub')).toBe(false)
  })

  test('a missing state file trusts nothing; CLAUDE_CONFIG_DIR moves it', async () => {
    expect(
      await claudeTrust({ homeDir: dir(), env: () => ({}) }).isFolderTrusted('/work/app'),
    ).toBe(false)
    mkdirSync(join(dir(), 'config'))
    writeFileSync(
      join(dir(), 'config/.claude.json'),
      JSON.stringify({ projects: { '/x': { hasTrustDialogAccepted: true } } }),
    )
    const moved = claudeTrust({
      homeDir: dir(),
      env: () => ({ CLAUDE_CONFIG_DIR: join(dir(), 'config') }),
    })
    expect(await moved.isFolderTrusted('/x')).toBe(true)
  })
})

describe('the CLAUDE_ENV_FILE files of one session', () => {
  test('names one file per kind, its folder made, the same path each call', async () => {
    const files = sessionEnvFiles(() => join(dir(), 'session-1'))
    const session = await files.path('session', signal)
    expect(session).toBe(join(dir(), 'session-1/session-start-env.sh'))
    expect(await files.path('session', signal)).toBe(session)
    expect(await files.path('cwd', signal)).toBe(join(dir(), 'session-1/cwd-env.sh'))
    expect(existsSync(join(dir(), 'session-1'))).toBe(true)
  })

  test('reads what a hook wrote, and a cwd change empties only the cwd file', async () => {
    const files = sessionEnvFiles(() => join(dir(), 'session-1'))
    const session = await files.path('session', signal)
    const cwd = await files.path('cwd', signal)
    writeFileSync(session, 'export A=1\n')
    writeFileSync(cwd, 'export B=2\n')
    expect(await files.read(session, signal)).toBe('export A=1\n')
    await files.clear('cwd', signal)
    expect(readFileSync(cwd, 'utf8')).toBe('')
    expect(await files.read(session, signal)).toBe('export A=1\n')
    expect(await files.read(join(dir(), 'none.sh'), signal)).toBeUndefined()
  })
})

describe('where a path really points', () => {
  test('follows links, has nothing for a missing path, and fails on a loop', async () => {
    mkdirSync(join(dir(), 'real'))
    symlinkSync(join(dir(), 'real'), join(dir(), 'link'))
    symlinkSync(join(dir(), 'loop-b'), join(dir(), 'loop-a'))
    symlinkSync(join(dir(), 'loop-a'), join(dir(), 'loop-b'))
    const real = await realPathResolver.realpath(join(dir(), 'link'))
    expect(typeof real === 'string' && real.endsWith('/real')).toBe(true)
    expect(await realPathResolver.realpath(join(dir(), 'missing'))).toBeUndefined()
    expect(await realPathResolver.realpath(join(dir(), 'loop-a'))).toMatchObject({
      failure: 'loop',
    })
  })
})
