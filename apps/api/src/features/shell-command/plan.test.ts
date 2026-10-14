import { describe, expect, test } from 'bun:test'

import { isDirOnPath, planShellCommand } from './plan'

describe('planShellCommand', () => {
  const base = { cliEntry: '/app/bin/localix.mjs', bunPath: '/usr/bin/bun' }

  test('posix installs an sh launcher into ~/.local/bin', () => {
    const plan = planShellCommand({ platform: 'linux', home: '/home/me', ...base })
    expect(plan.kind).toBe('posix-script')
    expect(plan.binDir).toBe('/home/me/.local/bin')
    expect(plan.targetPath).toBe('/home/me/.local/bin/localix')
    expect(plan.mode).toBe(0o755)
    expect(plan.launcher).toBe(`#!/bin/sh\nexec '/usr/bin/bun' '/app/bin/localix.mjs' "$@"\n`)
  })

  test('macOS uses the same posix layout', () => {
    const plan = planShellCommand({ platform: 'darwin', home: '/Users/me', ...base })
    expect(plan.targetPath).toBe('/Users/me/.local/bin/localix')
  })

  test('posix launcher single-quote-escapes paths with quotes', () => {
    const plan = planShellCommand({
      platform: 'linux',
      home: '/home/me',
      cliEntry: `/a'b/localix.mjs`,
      bunPath: '/usr/bin/bun',
    })
    expect(plan.launcher).toContain(`'/a'\\''b/localix.mjs'`)
  })

  test('windows writes a cmd shim under %LOCALAPPDATA%\\Localix\\bin', () => {
    const plan = planShellCommand({
      platform: 'win32',
      home: 'C:\\Users\\me',
      cliEntry: 'C:\\app\\bin\\localix.mjs',
      bunPath: 'C:\\bun\\bun.exe',
      localAppData: 'C:\\Users\\me\\AppData\\Local',
    })
    expect(plan.kind).toBe('windows-cmd')
    expect(plan.targetPath).toBe('C:\\Users\\me\\AppData\\Local\\Localix\\bin\\localix.cmd')
    expect(plan.launcher).toBe('@echo off\r\n"C:\\bun\\bun.exe" "C:\\app\\bin\\localix.mjs" %*\r\n')
  })

  test('windows falls back to <home>\\AppData\\Local without localAppData', () => {
    const plan = planShellCommand({
      platform: 'win32',
      home: 'C:\\Users\\me',
      cliEntry: 'C:\\app\\localix.mjs',
      bunPath: 'C:\\bun\\bun.exe',
    })
    expect(plan.binDir).toBe('C:\\Users\\me\\AppData\\Local\\Localix\\bin')
  })
})

describe('isDirOnPath', () => {
  test('posix membership is exact + trailing-slash insensitive', () => {
    const PATH = '/usr/bin:/home/me/.local/bin:/opt/x'
    expect(isDirOnPath('/home/me/.local/bin', PATH, 'linux')).toBe(true)
    expect(isDirOnPath('/home/me/.local/bin/', PATH, 'linux')).toBe(true)
    expect(isDirOnPath('/home/me/bin', PATH, 'linux')).toBe(false)
  })

  test('windows membership is case-insensitive + separator-aware', () => {
    const PATH = 'C:\\Windows;C:\\Users\\me\\AppData\\Local\\Localix\\bin'
    expect(isDirOnPath('c:\\users\\me\\appdata\\local\\localix\\bin', PATH, 'win32')).toBe(true)
    expect(isDirOnPath('C:\\Other', PATH, 'win32')).toBe(false)
  })
})
