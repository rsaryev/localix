import { describe, expect, test } from 'bun:test'

import { parseFrame } from './frameParser'

describe('parseFrame — session frames', () => {
  test('splits s\\n<cursor>\\n<sessionId>\\n<json> into parts', () => {
    const frame = parseFrame('s\nboot-a:42\nsess-1\n{"type":"run.started","sessionId":"sess-1"}')
    expect(frame).toEqual({
      kind: 'session',
      cursor: 'boot-a:42',
      sessionId: 'sess-1',
      json: '{"type":"run.started","sessionId":"sess-1"}',
    })
  })

  test('payload may contain escaped newlines without breaking the split', () => {
    const frame = parseFrame('s\nboot-a:7\nsess-2\n{"type":"x","text":"line1\\nline2"}')
    expect(frame).toMatchObject({ kind: 'session', cursor: 'boot-a:7', sessionId: 'sess-2' })
    // json is returned raw (not parsed) — the escaped \n is preserved verbatim.
    expect((frame as { json: string }).json).toBe('{"type":"x","text":"line1\\nline2"}')
  })

  test('rejects an empty or non-namespaced cursor', () => {
    expect(parseFrame('s\n\n\n{}')).toBeNull()
    expect(parseFrame('s\n42\nsess-1\n{}')).toBeNull()
  })

  test('returns null when the envelope is truncated (missing third newline)', () => {
    expect(parseFrame('s\nboot-a:42\nsess-1')).toBeNull()
    expect(parseFrame('s\nboot-a:42')).toBeNull()
    expect(parseFrame('s')).toBeNull()
  })
})

describe('parseFrame — rpc + generic frames', () => {
  test('rpc frame returns the json tail', () => {
    expect(parseFrame('r\n{"id":"1","ok":true}')).toEqual({
      kind: 'rpc',
      json: '{"id":"1","ok":true}',
    })
  })

  test('generic subsystem frame returns the tag + json tail', () => {
    expect(parseFrame('w\n{"kind":"pod","action":"ADDED"}')).toEqual({
      kind: 'frame',
      tag: 'w',
      json: '{"kind":"pod","action":"ADDED"}',
    })
  })

  test('rpc/generic-frame with no newline → null', () => {
    expect(parseFrame('r')).toBeNull()
    expect(parseFrame('w')).toBeNull()
  })
})

describe('parseFrame — generic frame / empty', () => {
  test('a non-reserved leading byte is a generic subsystem frame', () => {
    expect(parseFrame('x\n{}')).toEqual({ kind: 'frame', tag: 'x', json: '{}' })
  })
  test('empty / multi-char tag before newline → null', () => {
    expect(parseFrame('')).toBeNull()
    // A leading token longer than one char (newline not at index 1) is not a frame.
    expect(parseFrame('xy\n{}')).toBeNull()
  })
})
