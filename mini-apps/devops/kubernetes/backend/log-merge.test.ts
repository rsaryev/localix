import { describe, expect, test } from 'bun:test'
import { mergeContainerLogs } from './log-merge'

const at = (seconds: number) => `2026-07-28T10:00:0${seconds}.000000000Z`

describe('mergeContainerLogs', () => {
  test("interleaves by timestamp and names each line's source", () => {
    // The whole point: the app's request and the sidecar's decision about it are one story.
    const merged = mergeContainerLogs([
      { container: 'app', lines: `${at(1)} GET /health\n${at(3)} 200 OK\n` },
      { container: 'proxy', lines: `${at(2)} upstream selected\n` },
    ])
    expect(merged.split('\n')).toEqual([
      `[app] ${at(1)} GET /health`,
      `[proxy] ${at(2)} upstream selected`,
      `[app] ${at(3)} 200 OK`,
    ])
  })

  test('equal timestamps keep a stable, stream-grouped order', () => {
    // Otherwise the same two lines swap places on every poll and the view flickers.
    const streams = [
      { container: 'a', lines: `${at(1)} first\n` },
      { container: 'b', lines: `${at(1)} second\n` },
    ]
    const once = mergeContainerLogs(streams)
    expect(once.split('\n')).toEqual([`[a] ${at(1)} first`, `[b] ${at(1)} second`])
    expect(mergeContainerLogs(streams)).toBe(once)
  })

  test('an unstamped continuation line stays with the line it belongs to', () => {
    // A stack trace whose continuation lines sorted to the top would be unreadable.
    const merged = mergeContainerLogs([
      {
        container: 'app',
        lines: `${at(1)} Traceback:\n  File "x.py", line 1\n  ZeroDivisionError\n`,
      },
      { container: 'proxy', lines: `${at(2)} 502\n` },
    ])
    expect(merged.split('\n')).toEqual([
      `[app] ${at(1)} Traceback:`,
      '[app]   File "x.py", line 1',
      '[app]   ZeroDivisionError',
      `[proxy] ${at(2)} 502`,
    ])
  })

  test('a stream that begins unstamped is kept, not dropped', () => {
    const merged = mergeContainerLogs([
      { container: 'app', lines: `no stamp here\n${at(2)} stamped\n` },
    ])
    expect(merged.split('\n')).toEqual(['[app] no stamp here', `[app] ${at(2)} stamped`])
  })

  test('a container that logged nothing contributes nothing', () => {
    const merged = mergeContainerLogs([
      { container: 'app', lines: `${at(1)} up\n` },
      { container: 'init', lines: '' },
    ])
    expect(merged).toBe(`[app] ${at(1)} up`)
  })

  test('no streams at all is empty text, not a stray newline', () => {
    expect(mergeContainerLogs([])).toBe('')
    expect(mergeContainerLogs([{ container: 'app', lines: '' }])).toBe('')
  })

  test('an unparseable timestamp is treated as unstamped rather than as epoch zero', () => {
    // `2026-13-45T…` parses to NaN; sorting NaN would put it anywhere.
    const merged = mergeContainerLogs([
      { container: 'app', lines: `${at(5)} real\n` },
      { container: 'odd', lines: '2026-13-45T99:99:99Z broken\n' },
    ])
    expect(merged.split('\n')[0]).toBe('[odd] 2026-13-45T99:99:99Z broken')
  })

  test('a single stream is prefixed but never reordered', () => {
    // Out-of-order stamps happen (clock skew inside the container); the runtime's own
    // order is not something to "fix" for one container.
    const merged = mergeContainerLogs([
      { container: 'app', lines: `${at(1)} a\n${at(2)} b\n${at(3)} c\n` },
    ])
    expect(merged.split('\n')).toEqual([`[app] ${at(1)} a`, `[app] ${at(2)} b`, `[app] ${at(3)} c`])
  })
})
