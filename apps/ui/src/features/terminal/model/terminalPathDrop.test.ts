import { describe, expect, it } from 'bun:test'
import { quoteShellPath, formatDroppedPaths, isPathDrop } from './terminalPathDrop'
import { MESSAGE_BINDING_MIME } from '@localixai/plugin-sdk/ui/message-binding-drag'

describe('quoteShellPath', () => {
  it('leaves clean paths verbatim', () => {
    expect(quoteShellPath('/usr/local/bin/foo-bar.ts', 'mac')).toBe('/usr/local/bin/foo-bar.ts')
    expect(quoteShellPath('src/App.tsx', 'linux')).toBe('src/App.tsx')
  })

  it('single-quotes spaced/special paths on posix', () => {
    expect(quoteShellPath('/a/My Docs/file.txt', 'mac')).toBe("'/a/My Docs/file.txt'")
    expect(quoteShellPath("it's.txt", 'linux')).toBe("'it'\\''s.txt'")
  })

  it('double-quotes on windows', () => {
    expect(quoteShellPath('C:\\My Files\\a.txt', 'windows')).toBe('"C:\\My Files\\a.txt"')
  })
})

describe('formatDroppedPaths', () => {
  it('joins with spaces and a trailing space', () => {
    expect(formatDroppedPaths(['a.txt', 'b c.txt'], 'mac')).toBe("a.txt 'b c.txt' ")
  })
  it('returns empty for no paths', () => {
    expect(formatDroppedPaths([], 'mac')).toBe('')
  })
})

describe('isPathDrop', () => {
  it('detects message-binding and OS file drags', () => {
    expect(isPathDrop([MESSAGE_BINDING_MIME])).toBe(true)
    expect(isPathDrop(['Files'])).toBe(true)
    expect(isPathDrop(['text/plain'])).toBe(false)
  })
})
