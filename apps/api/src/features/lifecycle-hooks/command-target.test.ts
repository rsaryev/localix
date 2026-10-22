import { describe, expect, test } from 'bun:test'
import { resolveHookSpawnTarget } from './command-target'

const bash = () => ({ shell: '/bin/bash', args: ['-c'] })
const noBash = () => {
  throw new Error('No bash shell found.')
}

describe('hook spawn target', () => {
  test('exec form spawns the command itself with its arguments, ignoring shell', () => {
    expect(
      resolveHookSpawnTarget(
        { command: 'node', args: ['a b.js', '$HOME'], shell: 'powershell' },
        { resolveBash: noBash, platform: 'win32' },
      ),
    ).toEqual({ file: 'node', argv: ['a b.js', '$HOME'] })
  })

  test('shell form runs through bash by default', () => {
    expect(resolveHookSpawnTarget({ command: 'echo hi' }, { resolveBash: bash })).toEqual({
      file: '/bin/bash',
      argv: ['-c', 'echo hi'],
    })
  })

  test('shell: powershell runs PowerShell on Windows and pwsh elsewhere', () => {
    const spec = { command: 'Get-Date', shell: 'powershell' as const }
    expect(resolveHookSpawnTarget(spec, { platform: 'win32', resolveBash: bash })).toEqual({
      file: 'powershell.exe',
      argv: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date'],
    })
    expect(resolveHookSpawnTarget(spec, { platform: 'darwin', resolveBash: bash }).file).toBe(
      'pwsh',
    )
  })

  test('Windows without Git Bash falls back to PowerShell; other hosts report the error', () => {
    expect(
      resolveHookSpawnTarget({ command: 'x' }, { platform: 'win32', resolveBash: noBash }).file,
    ).toBe('powershell.exe')
    expect(() =>
      resolveHookSpawnTarget({ command: 'x' }, { platform: 'linux', resolveBash: noBash }),
    ).toThrow('No bash')
  })

  test('rewrites a shell-form command for PowerShell only when PowerShell runs it', () => {
    const spec = { command: 'run ${X}', forPowerShell: (c: string) => c.replace('${X}', '$env:X') }
    expect(resolveHookSpawnTarget(spec, { resolveBash: bash }).argv).toEqual(['-c', 'run ${X}'])
    expect(
      resolveHookSpawnTarget({ ...spec, shell: 'powershell' }, { platform: 'darwin' }).argv.at(-1),
    ).toBe('run $env:X')
    expect(
      resolveHookSpawnTarget(spec, { platform: 'win32', resolveBash: noBash }).argv.at(-1),
    ).toBe('run $env:X')
    expect(resolveHookSpawnTarget({ ...spec, args: ['${X}'] }, { platform: 'win32' }).argv).toEqual(
      ['${X}'],
    )
  })
})
