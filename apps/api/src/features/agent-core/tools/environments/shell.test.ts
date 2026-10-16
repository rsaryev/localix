import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  gitBashForGitExe,
  isWslLauncher,
  resolveShellConfig,
  resetShellConfigCache,
  whichBinary,
} from './shell'

describe('Windows bash candidates', () => {
  // The WSL launcher is usually the FIRST bash on a Windows PATH (Git adds only `cmd\`),
  // and it runs commands in a Linux VM that sees neither our cwd nor our env.
  test('the WSL launcher is rejected wherever Windows puts it', () => {
    expect(isWslLauncher('C:\\Windows\\System32\\bash.exe')).toBe(true)
    expect(isWslLauncher('c:\\windows\\SysWOW64\\BASH.EXE')).toBe(true)
    expect(isWslLauncher('C:\\Windows\\Sysnative\\bash.exe')).toBe(true)
    expect(isWslLauncher('C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe')).toBe(
      true,
    )
  })

  test('a real Windows bash is kept', () => {
    expect(isWslLauncher('C:\\Program Files\\Git\\bin\\bash.exe')).toBe(false)
    expect(isWslLauncher('C:\\msys64\\usr\\bin\\bash.exe')).toBe(false)
    expect(isWslLauncher('D:/scoop/apps/git/current/bin/bash.exe')).toBe(false)
  })

  test("Git Bash is found from any of git.exe's three install locations", () => {
    const bash = 'D:\\tools\\Git\\bin\\bash.exe'
    expect(gitBashForGitExe('D:\\tools\\Git\\cmd\\git.exe')).toBe(bash)
    expect(gitBashForGitExe('D:\\tools\\Git\\bin\\git.exe')).toBe(bash)
    expect(gitBashForGitExe('D:\\tools\\Git\\mingw64\\bin\\git.exe')).toBe(bash)
    expect(gitBashForGitExe('C:\\somewhere\\git.exe')).toBeUndefined()
  })
})

afterEach(() => {
  resetShellConfigCache()
  delete process.env.LOCALIX_SHELL
  delete process.env.LOCALIX_BASH_PATH
})

describe('resolveShellConfig', () => {
  test('returns a shell with -c args', () => {
    const cfg = resolveShellConfig()
    expect(cfg.args).toEqual(['-c'])
    expect(typeof cfg.shell).toBe('string')
    expect(cfg.shell.length).toBeGreaterThan(0)
  })

  test('memoizes the result', () => {
    const a = resolveShellConfig()
    const b = resolveShellConfig()
    expect(a).toBe(b)
  })

  test('honors the LOCALIX_SHELL override when it points at a real file', () => {
    // Every platform we test on has a POSIX sh here; use it as a stand-in for a
    // user-provided bash path. Cache must be reset for the env to take effect.
    const candidate = whichBinary('sh') ?? whichBinary('bash')
    if (!candidate) return // no shell on this host — skip
    resetShellConfigCache()
    process.env.LOCALIX_SHELL = candidate
    expect(resolveShellConfig().shell).toBe(candidate)
  })

  test('ignores LOCALIX_SHELL when the path does not exist', () => {
    resetShellConfigCache()
    process.env.LOCALIX_SHELL = '/nonexistent/path/to/bash'
    const cfg = resolveShellConfig()
    expect(cfg.shell).not.toBe('/nonexistent/path/to/bash')
  })
})

describe('whichBinary', () => {
  test('resolves a binary that is on PATH', () => {
    // `sh` exists on macOS/Linux; on Windows CI a bash/sh from Git is expected.
    const hit = whichBinary('sh') ?? whichBinary('bash') ?? whichBinary('node')
    expect(hit).toBeTruthy()
  })

  test('returns undefined for a binary that does not exist', () => {
    expect(whichBinary('definitely-not-a-real-binary-xyz')).toBeUndefined()
  })

  // Under a GUI launch the ambient PATH is launchd's bare one; the spawned child gets the
  // repaired PATH. The lookup must search the PATH the child will run with, not the ambient one.
  test.skipIf(process.platform === 'win32')(
    'searches the PATH of the env it is given, not the ambient process PATH',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'which-'))
      try {
        const bin = join(dir, 'localix-only-here')
        writeFileSync(bin, '#!/bin/sh\n')
        chmodSync(bin, 0o755)
        expect(whichBinary('localix-only-here')).toBeUndefined()
        expect(whichBinary('localix-only-here', { PATH: dir })).toBe(bin)
        expect(whichBinary('sh', { PATH: dir })).toBeUndefined()
        // A Windows-style env copy spells it `Path`.
        expect(whichBinary('localix-only-here', { Path: dir })).toBe(bin)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
