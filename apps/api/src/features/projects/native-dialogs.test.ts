import { describe, expect, test } from 'bun:test'

import { windowsDialogArgv } from './native-dialogs'

describe('Windows dialog command', () => {
  // Redirected PowerShell stdout is in the OEM code page, decoded here as UTF-8: a folder
  // with a non-ASCII name came back as mojibake and the project pointed nowhere.
  test('forces BOM-less UTF-8 stdout BEFORE the dialog script runs', () => {
    const argv = windowsDialogArgv('Write-Output $d.SelectedPath')
    const command = argv[argv.indexOf('-Command') + 1]!
    expect(
      command.startsWith('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;'),
    ).toBe(true)
    expect(command.endsWith('Write-Output $d.SelectedPath')).toBe(true)
  })

  test('keeps the flags WinForms and an unattended host need', () => {
    const argv = windowsDialogArgv('x')
    expect(argv.slice(0, 4)).toEqual(['-NoProfile', '-STA', '-NonInteractive', '-Command'])
    expect(argv).toHaveLength(5)
  })
})
