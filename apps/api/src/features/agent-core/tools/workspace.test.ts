import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { isInsideWorkspace, outsideHomePathsInCommand, sessionScratchDir } from './workspace'

describe('sessionScratchDir', () => {
  test('resolves under ~/.localix/tmp/sessions/<id>', () => {
    expect(sessionScratchDir('abc123')).toBe(
      path.join(os.homedir(), '.localix', 'tmp', 'sessions', 'abc123'),
    )
  })
})

describe('isInsideWorkspace', () => {
  const root = '/Users/me/project'

  test('files inside the root are allowed', () => {
    expect(isInsideWorkspace(root, '/Users/me/project/src/a.ts')).toBe(true)
    expect(isInsideWorkspace(root, root)).toBe(true)
    expect(isInsideWorkspace(root, '/Users/me/project/./nested/../b.ts')).toBe(true)
  })

  test('files outside the root are rejected', () => {
    expect(isInsideWorkspace(root, '/Users/me/other/a.ts')).toBe(false)
    expect(isInsideWorkspace(root, '/Users/me/project/../escape.txt')).toBe(false)
    expect(isInsideWorkspace(root, '/etc/passwd')).toBe(false)
  })

  test('a "/" or empty root means no boundary (always inside)', () => {
    expect(isInsideWorkspace('/', '/anything')).toBe(true)
    expect(isInsideWorkspace('', '/anything')).toBe(true)
    expect(isInsideWorkspace(undefined, '/anything')).toBe(true)
  })
})

describe('outsideHomePathsInCommand', () => {
  const home = os.homedir()
  const root = path.join(home, 'project')

  test('flags a cd to another user dir outside the workspace', () => {
    const found = outsideHomePathsInCommand(
      `cd ${path.join(home, 'tests')} && npm create vite`,
      root,
    )
    expect(found).toContain(path.join(home, 'tests'))
  })

  test('ignores system paths and in-workspace paths', () => {
    expect(outsideHomePathsInCommand('cat /etc/hosts && ls /usr/bin', root)).toEqual([])
    expect(outsideHomePathsInCommand(`node ${path.join(root, 'src/x.js')}`, root)).toEqual([])
    expect(outsideHomePathsInCommand('echo hello > /tmp/x', root)).toEqual([])
  })

  test('a JS regex literal or escaped quote is not a path — a node -e one-liner stays inside', () => {
    const script = `node -e "const ids=[...html.matchAll(/getElementById\\(['\\\\\\"]([^'\\\\\\"]+)['\\\\\\"]\\)/g)]; console.log(/onkeydown/.test(html))"`
    expect(outsideHomePathsInCommand(script, root, root)).toEqual([])
  })

  test('expands ~ to home', () => {
    const found = outsideHomePathsInCommand('cd ~/elsewhere', root)
    expect(found).toContain(path.join(home, 'elsewhere'))
  })

  // Windows paths were invisible to this control. `C:/Users/me/other` matched only
  // from the colon onward, as the unrelated POSIX path `/Users/me/other`, which is
  // not under the Windows home and was dropped — so a command running inside the
  // workspace could name any file in the user's profile and the permission card
  // stayed silent. `home` is injected so the shape is checkable from any host;
  // forward slashes are valid Windows paths and keep `node:path` semantics
  // identical here and there.
  describe('Windows path tokens', () => {
    const winHome = 'C:/Users/me'
    const winRoot = 'C:/Users/me/project'

    test('flags a drive-absolute path outside the workspace', () => {
      const found = outsideHomePathsInCommand(
        'cp secrets.txt C:/Users/me/other/dump.txt',
        winRoot,
        undefined,
        winHome,
      )
      expect(found).toContain('C:/Users/me/other/dump.txt')
    })

    test('leaves a drive-absolute path inside the workspace alone', () => {
      expect(
        outsideHomePathsInCommand('node C:/Users/me/project/src/x.js', winRoot, undefined, winHome),
      ).toEqual([])
    })

    test('ignores another profile — outside the home, like a system path', () => {
      expect(
        outsideHomePathsInCommand('type C:/Users/someone/f.txt', winRoot, undefined, winHome),
      ).toEqual([])
    })
  })
})
