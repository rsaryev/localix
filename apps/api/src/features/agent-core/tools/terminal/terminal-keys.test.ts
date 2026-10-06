import { describe, expect, it } from 'bun:test'
import { encodeKeys } from './terminal-keys'

describe('encodeKeys', () => {
  it('encodes arrow keys to VT escapes', () => {
    expect(encodeKeys(['Up', 'Down', 'Right', 'Left'])).toBe('\x1b[A\x1b[B\x1b[C\x1b[D')
  })

  it('uses application cursor sequences only for cursor keys in DECCKM mode', () => {
    expect(encodeKeys(['Up', 'Down', 'Right', 'Left', 'Home', 'End'], true)).toBe(
      '\x1bOA\x1bOB\x1bOC\x1bOD\x1bOH\x1bOF',
    )
    expect(encodeKeys(['Enter', 'Escape', 'Shift+Tab', 'PageUp', 'text'], true)).toBe(
      '\r\x1b\x1b[Z\x1b[5~text',
    )
  })

  it('encodes Enter / Tab / Escape', () => {
    expect(encodeKeys(['Enter'])).toBe('\r')
    expect(encodeKeys(['Tab'])).toBe('\t')
    expect(encodeKeys(['Escape'])).toBe('\x1b')
  })

  it('is case-insensitive for key names', () => {
    expect(encodeKeys(['enter'])).toBe('\r')
    expect(encodeKeys(['ESCAPE'])).toBe('\x1b')
  })

  it('encodes Ctrl+<char> to a control byte', () => {
    expect(encodeKeys(['Ctrl+C'])).toBe('\x03')
    expect(encodeKeys(['Ctrl+a'])).toBe('\x01')
    expect(encodeKeys(['ctrl+d'])).toBe('\x04')
  })

  it('encodes Alt+<char> with an ESC prefix', () => {
    expect(encodeKeys(['Alt+x'])).toBe('\x1bx')
  })

  it('passes literal text through unchanged', () => {
    expect(encodeKeys(['hello'])).toBe('hello')
    expect(encodeKeys([':wq'])).toBe(':wq')
  })

  it('encodes a full vim sequence', () => {
    expect(encodeKeys(['i', 'hello', 'Escape', ':wq', 'Enter'])).toBe('ihello\x1b:wq\r')
  })

  it('encodes function keys', () => {
    expect(encodeKeys(['F1'])).toBe('\x1bOP')
    expect(encodeKeys(['F12'])).toBe('\x1b[24~')
  })

  it('encodes Shift+Tab / back-tab in several spellings', () => {
    expect(encodeKeys(['BackTab'])).toBe('\x1b[Z')
    expect(encodeKeys(['Shift+Tab'])).toBe('\x1b[Z')
    expect(encodeKeys(['shifttab'])).toBe('\x1b[Z')
  })

  it('tolerates separators in multi-word key names', () => {
    expect(encodeKeys(['Page Up'])).toBe('\x1b[5~')
    expect(encodeKeys(['page_down'])).toBe('\x1b[6~')
  })
})
