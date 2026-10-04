import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'

import { stdinIsParentPipe, watchParentStdin } from './desktop-parent'

const stat = (kind: 'pipe' | 'char' | 'file') => ({
  isCharacterDevice: () => kind === 'char',
  isFile: () => kind === 'file',
})

describe('stdinIsParentPipe', () => {
  test('the desktop shell pipe is the one stream whose end means the parent died', () => {
    expect(stdinIsParentPipe({ parentPid: 42, isTTY: false, stat: stat('pipe') })).toBe(true)
  })

  // Each of these reads EOF (or nothing) on its own; arming on it would stop a healthy
  // runtime the moment it started — the dev and CLI launches among them.
  test('never a TTY, /dev/null or NUL, a redirected file, or a launch with no parent', () => {
    expect(stdinIsParentPipe({ parentPid: 42, isTTY: true, stat: stat('char') })).toBe(false)
    expect(stdinIsParentPipe({ parentPid: 42, isTTY: false, stat: stat('char') })).toBe(false)
    expect(stdinIsParentPipe({ parentPid: 42, isTTY: false, stat: stat('file') })).toBe(false)
    expect(stdinIsParentPipe({ parentPid: undefined, isTTY: false, stat: stat('pipe') })).toBe(
      false,
    )
    expect(stdinIsParentPipe({ parentPid: 42, isTTY: false, stat: undefined })).toBe(false)
  })
})

describe('watchParentStdin', () => {
  test('the parent closing its end fires once, however the close is reported', async () => {
    const pipe = new PassThrough()
    let gone = 0
    watchParentStdin(pipe, () => gone++)
    pipe.end()
    await new Promise((resolve) => setImmediate(resolve))
    pipe.destroy()
    await new Promise((resolve) => setImmediate(resolve))
    expect(gone).toBe(1)
  })

  test('data alone is not the parent leaving', async () => {
    const pipe = new PassThrough()
    let gone = 0
    watchParentStdin(pipe, () => gone++)
    pipe.write('shutdown-not-yet\n')
    await new Promise((resolve) => setImmediate(resolve))
    expect(gone).toBe(0)
  })
})
