import { describe, expect, test } from 'bun:test'
import { currentPlatform, handoffCommand } from './command'

describe('handoffCommand', () => {
  test('macOS hands every mode to `open`, whose exit status is an answer', () => {
    expect(handoffCommand('darwin', { kind: 'url', url: 'https://localix.ai' })).toEqual({
      cmd: 'open',
      args: ['https://localix.ai'],
      awaits: 'exit',
    })
    expect(handoffCommand('darwin', { kind: 'app', path: '/t/a.csv', app: 'Numbers' })).toEqual({
      cmd: 'open',
      args: ['-a', 'Numbers', '/t/a.csv'],
      awaits: 'exit',
    })
    expect(handoffCommand('darwin', { kind: 'reveal', path: '/t/a.csv' })).toEqual({
      cmd: 'open',
      args: ['-R', '/t/a.csv'],
      awaits: 'exit',
    })
  })

  test('Windows opens through ShellExecute (rundll32) and is judged leniently', () => {
    const command = handoffCommand('win32', { kind: 'path', path: 'C:\\t\\a.csv' })
    expect(command).toEqual({
      cmd: 'rundll32',
      args: ['url.dll,FileProtocolHandler', 'C:\\t\\a.csv'],
      awaits: 'exit',
      lenientExit: true,
    })
  })

  // `cmd /c start "" <url>` handed the URL to cmd.exe's parser: an unquoted `&` began
  // a second command. No Windows row may route a target through a shell.
  test('a Windows URL with shell metacharacters never reaches cmd.exe', () => {
    const url = 'https://x.test/?a=1&calc|whoami^%PATH%'
    const command = handoffCommand('win32', { kind: 'url', url })
    expect(command.cmd).not.toMatch(/^(cmd|powershell|pwsh)(\.exe)?$/i)
    expect(command.args).toEqual(['url.dll,FileProtocolHandler', url])
  })

  test('Windows reveal keeps `/select,<path>` as ONE argument', () => {
    // A space after the comma makes Explorer open the parent folder instead of
    // selecting the file — the whole point of revealing.
    expect(handoffCommand('win32', { kind: 'reveal', path: 'C:\\t\\a.csv' }).args).toEqual([
      '/select,C:\\t\\a.csv',
    ])
  })

  test('a named application off macOS is the app itself, so nothing waits on it', () => {
    expect(handoffCommand('linux', { kind: 'app', path: '/t/a.csv', app: 'libreoffice' })).toEqual({
      cmd: 'libreoffice',
      args: ['/t/a.csv'],
      awaits: 'spawn',
    })
    expect(handoffCommand('win32', { kind: 'app', path: 'C:\\a.csv', app: 'soffice' }).awaits).toBe(
      'spawn',
    )
  })

  test('Linux reveal falls back to the containing directory', () => {
    expect(handoffCommand('linux', { kind: 'reveal', path: '/home/u/docs/a.csv' }).args).toEqual([
      '/home/u/docs',
    ])
    // A file at the root still reveals a directory, not an empty string.
    expect(handoffCommand('linux', { kind: 'reveal', path: '/a.csv' }).args).toEqual(['/'])
    expect(handoffCommand('linux', { kind: 'reveal', path: 'a.csv' }).args).toEqual(['.'])
  })
})

describe('currentPlatform', () => {
  test('narrows to the three platforms the table knows, defaulting to linux', () => {
    expect(currentPlatform('darwin')).toBe('darwin')
    expect(currentPlatform('win32')).toBe('win32')
    expect(currentPlatform('freebsd')).toBe('linux')
  })
})
