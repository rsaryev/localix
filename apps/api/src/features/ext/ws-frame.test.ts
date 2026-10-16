/**
 * The owner's suite for the `/rpc/ws` frame envelope.
 *
 * This is the anchor test for the wire format: the client re-exports `parseFrame` from
 * here (`apps/ui/src/shared/api/frameParser.ts`), so a change to the envelope turns this
 * suite red — and, because the client DERIVES rather than copies, turns its suite red
 * too. That derivation is the anti-drift guard; a test that merely restated the rule on
 * the client side would just be a second copy of it.
 */
import { describe, expect, test } from 'bun:test'

import {
  encodeSessionCursor,
  isSessionCursorNewer,
  parseFrame,
  parseSessionCursor,
} from './ws-frame'

describe('session cursor contract', () => {
  test('accepts only <boot-epoch>:<sequence>', () => {
    expect(encodeSessionCursor('boot-a', '42')).toBe('boot-a:42')
    expect(parseSessionCursor('boot-a:42')).toEqual({ epoch: 'boot-a', sequence: '42' })
    expect(parseSessionCursor('42')).toBeNull()
    expect(parseSessionCursor(':42')).toBeNull()
    expect(parseSessionCursor('boot-a:not-a-sequence')).toBeNull()
  })

  test('compares sequence values only inside the same boot epoch', () => {
    expect(isSessionCursorNewer('boot-a:1', null)).toBe(true)
    expect(isSessionCursorNewer('boot-a:2', 'boot-a:1')).toBe(true)
    expect(isSessionCursorNewer('boot-a:2', 'boot-a:2')).toBe(false)
    expect(isSessionCursorNewer('boot-a:1', 'boot-a:2')).toBe(false)
    expect(isSessionCursorNewer('boot-b:1', 'boot-a:999')).toBe(true)
    expect(isSessionCursorNewer('42', 'boot-a:1')).toBe(false)
  })

  test('compares sequences beyond JavaScript safe integer precision', () => {
    expect(isSessionCursorNewer('boot-a:9007199254740993', 'boot-a:9007199254740992')).toBe(true)
    expect(isSessionCursorNewer('boot-a:00042', 'boot-a:41')).toBe(true)
  })
})

describe('parseFrame — core frame kinds', () => {
  test('session frame splits into cursor / sessionId / json', () => {
    expect(parseFrame('s\nboot-a:42\nsess-1\n{"type":"run.started"}')).toEqual({
      kind: 'session',
      cursor: 'boot-a:42',
      sessionId: 'sess-1',
      json: '{"type":"run.started"}',
    })
  })

  test('an rpc frame returns the json tail', () => {
    expect(parseFrame('r\n{"id":"q1","ok":true}')).toEqual({
      kind: 'rpc',
      json: '{"id":"q1","ok":true}',
    })
    expect(parseFrame('r')).toBeNull()
  })

  test('a truncated session envelope is rejected rather than mis-split', () => {
    expect(parseFrame('s\nboot-a:42\nsess-1')).toBeNull()
    expect(parseFrame('s\nboot-a:42')).toBeNull()
    expect(parseFrame('s')).toBeNull()
  })

  test('an escaped newline in the payload does not break the split', () => {
    const frame = parseFrame('s\nboot-a:7\nsess-2\n{"text":"line1\\nline2"}')
    expect(frame).toMatchObject({ kind: 'session', cursor: 'boot-a:7', sessionId: 'sess-2' })
    expect((frame as { json: string }).json).toBe('{"text":"line1\\nline2"}')
  })

  test('rejects a session frame with a non-namespaced cursor', () => {
    expect(parseFrame('s\n42\nsess-1\n{}')).toBeNull()
  })
})

describe('parseFrame — generic subsystem frames (ws-frame-registry)', () => {
  // `createWsFrameConnection` emits `<frameTag>\n<data>` for every contributed live
  // stream. These MUST decode, or a subsystem's whole stream is silently discarded.
  test('decodes a contributed frame into its tag + payload', () => {
    // Two synthetic contributed streams prove that core does not name either subsystem.
    expect(parseFrame('w\n{"type":"MODIFIED","pod":{"name":"api-0"}}')).toEqual({
      kind: 'frame',
      tag: 'w',
      json: '{"type":"MODIFIED","pod":{"name":"api-0"}}',
    })
    expect(parseFrame('m\n{"channel":"ticker"}')).toEqual({
      kind: 'frame',
      tag: 'm',
      json: '{"channel":"ticker"}',
    })
  })

  test('any non-reserved single char is a valid tag — core names no subsystem', () => {
    expect(parseFrame('x\n{}')).toEqual({ kind: 'frame', tag: 'x', json: '{}' })
    expect(parseFrame('z\n[]')).toEqual({ kind: 'frame', tag: 'z', json: '[]' })
  })

  test('the tag must be exactly one char followed by a newline', () => {
    expect(parseFrame('')).toBeNull()
    expect(parseFrame('w')).toBeNull() // no delimiter
    expect(parseFrame('ww\n{}')).toBeNull() // multi-char tag
    expect(parseFrame('\n{}')).toBeNull() // empty tag
  })

  test('s / r stay reserved and never decode as a generic frame', () => {
    for (const raw of ['s\nboot-a:1\nsess\n{}', 'r\n{}']) {
      expect(parseFrame(raw)?.kind).not.toBe('frame')
    }
  })

  // The task board left core for a plugin, and its live stream with it: a `k` frame is now
  // whatever contribution registered that tag. A parser that still special-cased it would hand
  // the plugin's frames to a core handler that no longer exists and drop the stream.
  test('k is no longer a core kind — it decodes as a contributed frame', () => {
    expect(parseFrame('k\n{"type":"task.created"}')).toEqual({
      kind: 'frame',
      tag: 'k',
      json: '{"type":"task.created"}',
    })
  })
})
