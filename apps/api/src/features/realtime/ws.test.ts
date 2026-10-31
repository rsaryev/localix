/// <reference types="bun" />

import { describe, expect, it } from 'bun:test'

import { SECRET_VALUE_MAX_LENGTH } from '../secrets/limits'
import {
  backpressureAction,
  deliverSessionFrameBatch,
  decodeResumeCursor,
  gapFrame,
  mergeRealtimeToolSurface,
  REALTIME_BACKPRESSURE_DROP_BYTES,
  REALTIME_BACKPRESSURE_HARD_CLOSE_BYTES,
  admitWatchedSessions,
  REALTIME_MAX_WATCHED_SESSIONS,
  parseWatchQuery,
  realtimeConnectionToolSurface,
} from './ws'
import { parseRealtimeCommand } from './ws-commands'
import type { StreamEnvelope } from '../chat/runtime/session-stream-registry'
import { encodeSessionCursor } from '../ext/ws-frame'
import { createRuntimeToolRegistry } from '../agent-core/tool-registry'
import {
  COMPLETION_INLINE_CONTENT_MAX,
  COMPLETION_REFERENCE_LIMIT,
} from '../inline-completion/contracts'

describe('session replay cursor epochs', () => {
  it('resumes within the same API boot', () => {
    const cursor = encodeSessionCursor('boot-a', '42')
    expect(cursor).toBe('boot-a:42')
    expect(decodeResumeCursor(cursor, 'boot-a')).toBe('42')
  })

  it('replays the retained ring after an API restart or malformed cursor', () => {
    expect(decodeResumeCursor('boot-a:900', 'boot-b')).toBe('0')
    expect(decodeResumeCursor('900', 'boot-b')).toBe('0')
    expect(decodeResumeCursor('boot-b:not-a-sequence', 'boot-b')).toBe('0')
  })

  it('keeps a first connection distinct from a reconnect', () => {
    expect(decodeResumeCursor(null, 'boot-a')).toBeNull()
  })
})

/**
 * The connect-time half of the scoped-firehose declaration. It rides the URL, not a command,
 * because the window between `onOpen` and the first client command is roster-only — every
 * watched-class frame published in it is dropped for good (they are live-only), which on a
 * mid-stream reconnect is a visibly stalled transcript.
 */
describe('parseWatchQuery', () => {
  it('reads a comma-separated declaration', () => {
    expect([...parseWatchQuery('s1,s2')]).toEqual(['s1', 's2'])
  })

  it('treats a missing or empty param as roster-only, never as a wildcard', () => {
    expect(parseWatchQuery(null).size).toBe(0)
    expect(parseWatchQuery('').size).toBe(0)
    expect(parseWatchQuery(',,').size).toBe(0)
  })

  it('trims and dedups — the client builds this string from a set of mounted surfaces', () => {
    expect([...parseWatchQuery(' s1 , s1,s2 ')]).toEqual(['s1', 's2'])
  })

  it('caps the set: it is read on every published frame', () => {
    const ids = Array.from({ length: REALTIME_MAX_WATCHED_SESSIONS + 10 }, (_, i) => `s${i}`)
    expect(parseWatchQuery(ids.join(',')).size).toBe(REALTIME_MAX_WATCHED_SESSIONS)
  })
})

/**
 * The ceiling, on the path that had no test.
 *
 * `session.watch` grows the set of a LIVE socket, and it carried its own copy of the rule: removing
 * its ceiling left every test in `features/realtime` and `features/chat/runtime` green, while the
 * identical mutation in `parseWatchQuery` reddened at once. Both now go through one function, and
 * these assert the part the query path cannot reach — a set that is ALREADY full.
 */
describe('admitWatchedSessions', () => {
  const full = () =>
    admitWatchedSessions(
      new Set<string>(),
      Array.from({ length: REALTIME_MAX_WATCHED_SESSIONS }, (_, index) => `s${index}`),
    )

  it('refuses to grow past the ceiling and keeps every id it already had', () => {
    const watching = full()

    admitWatchedSessions(watching, ['newcomer'])

    // Value-independent, so it still means something if the ceiling is ever retuned: nothing was
    // evicted to make room. The oldest id belongs to a surface that is still mounted, and dropping
    // it would make that surface go blind without saying so.
    expect(watching.has('newcomer')).toBe(false)
    expect(watching.has('s0')).toBe(true)
    expect(watching.size).toBe(REALTIME_MAX_WATCHED_SESSIONS)
  })

  it('trims and skips the empties a query string leaves behind', () => {
    expect([...admitWatchedSessions(new Set<string>(), [' a ', '', 'b'])]).toEqual(['a', 'b'])
  })
})

describe('realtime client tool surface', () => {
  it('binds workbench capability to the connection and preserves request catalogs', () => {
    const connection = realtimeConnectionToolSurface('workbench')
    expect(connection).toEqual({ capabilities: ['workbench-ui'] })
    expect(
      mergeRealtimeToolSurface(connection, {
        capabilities: [],
        catalogs: { 'workbench-ui': 'catalog-1' },
      }),
    ).toEqual({
      capabilities: ['workbench-ui'],
      catalogs: { 'workbench-ui': 'catalog-1' },
    })
  })

  it('does not grant a UI surface to clients that did not identify as workbench', () => {
    expect(realtimeConnectionToolSurface('terminal')).toBeUndefined()
    expect(
      mergeRealtimeToolSurface(realtimeConnectionToolSurface('terminal'), { capabilities: [] }),
    ).toEqual({
      capabilities: [],
    })
  })

  it('keeps marker-less legacy workbench sockets compatible', () => {
    const surface = realtimeConnectionToolSurface(undefined)
    expect(surface).toEqual({
      capabilities: ['workbench-ui'],
    })
    // The surface admits a host tool that requires the workbench capability; a plugin-shaped
    // extra tool stands in for it here.
    const workbenchTool = {
      name: 'workbench_probe',
      description: 'ui',
      inputSchema: {} as never,
      activeVerb: 'Finding',
      availability: { requiredCapabilities: ['workbench-ui'] },
      execute: async () => ({ content: '' }),
    }
    expect(
      createRuntimeToolRegistry({
        policy: { toolSurface: surface, extraTools: [workbenchTool] },
      }).toolNames,
    ).toContain('workbench_probe')
    expect(
      createRuntimeToolRegistry({
        policy: { toolSurface: { capabilities: [] }, extraTools: [workbenchTool] },
      }).toolNames,
    ).not.toContain('workbench_probe')
  })
})

describe('the soft backpressure valve (a hard-close decision is not a drop)', () => {
  const T = REALTIME_BACKPRESSURE_DROP_BYTES
  const shouldDropFrame = (liveOnly: boolean, bytes: number, threshold = T) =>
    backpressureAction(liveOnly, bytes, threshold) === 'drop'

  it('drops a live-only frame only once the buffer exceeds the threshold', () => {
    expect(shouldDropFrame(true, T + 1)).toBe(true)
    expect(shouldDropFrame(true, T)).toBe(false) // not strictly over
    expect(shouldDropFrame(true, 0)).toBe(false)
    expect(shouldDropFrame(true, 1024)).toBe(false) // normal operation never drops
  })

  it('never drops a replayable frame, no matter the buffer depth', () => {
    expect(shouldDropFrame(false, T * 10)).toBe(false)
    expect(shouldDropFrame(false, Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it('honors a custom threshold', () => {
    expect(shouldDropFrame(true, 1500, 1000)).toBe(true)
    expect(shouldDropFrame(true, 500, 1000)).toBe(false)
  })

  it('accepts an edit-prediction v2 envelope and a cancellation command', () => {
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'predictNextEdit',
        requestId: 'prediction-1',
        sessionId: 's1',
        file: '/repo/a.ts',
        content: 'const a = 1',
        documentVersion: 4,
        documentDigest: 'fnv1a64:12345678:11',
        contextFingerprint: 'context:12345678',
        cursorLine: 1,
        cursorColumn: 3,
        language: 'typescript',
        recentlyEditedRanges: [],
      }),
    ).toMatchObject({
      kind: 'predictNextEdit',
      payload: { requestId: 'prediction-1', documentVersion: 4 },
    })
    expect(parseRealtimeCommand({ id: 'cancel:q1', t: 'cancel', requestId: 'q1' })).toEqual({
      kind: 'cancel',
      requestId: 'q1',
    })
  })
})

describe('backpressureAction (bounded native buffer)', () => {
  const DROP = REALTIME_BACKPRESSURE_DROP_BYTES
  const CLOSE = REALTIME_BACKPRESSURE_HARD_CLOSE_BYTES

  it('drops live-only frames above the soft threshold', () => {
    expect(backpressureAction(true, DROP + 1)).toBe('drop')
    expect(backpressureAction(true, DROP)).toBe('send')
  })

  it('keeps sending replayable frames between the soft and hard thresholds', () => {
    expect(backpressureAction(false, DROP + 1)).toBe('send')
    expect(backpressureAction(false, CLOSE)).toBe('send')
  })

  it('hard-closes every tier once the native buffer exceeds the hard threshold', () => {
    expect(backpressureAction(true, CLOSE + 1)).toBe('close')
    expect(backpressureAction(false, CLOSE + 1)).toBe('close')
  })
})

describe('deliverSessionFrameBatch', () => {
  const delta = (
    id: string,
    sessionId: string,
    textAppend: string,
    messageId = 'message-1',
  ): StreamEnvelope => {
    const event = {
      type: 'message.delta' as const,
      sessionId,
      messageId,
      textItemId: 'text-1',
      textAppend,
    }
    return { id, sessionId, event, data: JSON.stringify(event) }
  }

  const started = (id: string, sessionId: string): StreamEnvelope => {
    const event = { type: 'run.started' as const, sessionId, messageId: 'message-1' }
    return { id, sessionId, event, data: JSON.stringify(event) }
  }

  it('coalesces only adjacent compatible deltas and preserves every boundary in wire order', () => {
    const sent: string[] = []
    deliverSessionFrameBatch(
      [
        delta('1', 'session-a', 'A'),
        delta('2', 'session-a', 'B'),
        started('3', 'session-a'),
        delta('4', 'session-b', 'C'),
        delta('5', 'session-a', 'D'),
      ],
      {
        epoch: 'boot-a',
        bufferedBytes: () => 0,
        send: (frame) => sent.push(frame),
        close: () => {},
      },
    )

    expect(sent).toHaveLength(4)
    expect(sent[0]).toBe(
      's\nboot-a:2\nsession-a\n' +
        JSON.stringify({
          type: 'message.delta',
          sessionId: 'session-a',
          messageId: 'message-1',
          textItemId: 'text-1',
          textAppend: 'AB',
        }),
    )
    expect(sent.slice(1).map((frame) => frame.split('\n')[2])).toEqual([
      'session-a',
      'session-b',
      'session-a',
    ])
    expect(JSON.parse(sent[1]!.split('\n').slice(3).join('\n')).type).toBe('run.started')
  })

  it('sends a long run of deltas as one frame carrying every append in order', () => {
    const sent: string[] = []
    const parts = Array.from({ length: 50 }, (_, i) => `t${i} `)
    deliverSessionFrameBatch(
      [
        ...parts.map((part, i) => delta(String(i + 1), 'session-a', part)),
        started('51', 'session-a'),
      ],
      {
        epoch: 'boot-a',
        bufferedBytes: () => 0,
        send: (frame) => sent.push(frame),
        close: () => {},
      },
    )

    expect(sent).toHaveLength(2)
    expect(sent[0]).toBe(
      's\nboot-a:50\nsession-a\n' +
        JSON.stringify({
          type: 'message.delta',
          sessionId: 'session-a',
          messageId: 'message-1',
          textItemId: 'text-1',
          textAppend: parts.join(''),
        }),
    )
    expect(sent[1]).toBe(`s\nboot-a:51\nsession-a\n${started('51', 'session-a').data}`)
  })

  it('turns dropped frames into one ordered lag marker with the exact skipped count', () => {
    const sent: string[] = []
    deliverSessionFrameBatch([delta('7', 'session-a', 'A'), delta('8', 'session-a', 'B')], {
      epoch: 'boot-a',
      bufferedBytes: () => 11,
      send: (frame) => sent.push(frame),
      close: () => {},
      dropThreshold: 10,
      hardCloseThreshold: 20,
    })

    expect(sent).toEqual([
      's\nboot-a:8\nsession-a\n' +
        JSON.stringify({
          type: 'transport.lagged',
          skipped: 2,
          eventType: 'message.delta',
        }),
    ])
  })
})

describe('parseRealtimeCommand', () => {
  // The live half of the scoped-firehose declaration: a subscribe/unsubscribe command PAIR
  // carrying ids, matching the generic live-stream idiom in ext/ws-frame-registry.ts.
  it('parses the session watch/unwatch pair', () => {
    expect(
      parseRealtimeCommand({ id: 'q1', t: 'session.watch', sessionIds: ['s1', 's2'] }),
    ).toEqual({ kind: 'session.watch', sessionIds: ['s1', 's2'] })
    expect(parseRealtimeCommand({ id: 'q1', t: 'session.unwatch', sessionIds: ['s1'] })).toEqual({
      kind: 'session.unwatch',
      sessionIds: ['s1'],
    })
  })

  it('rejects an empty, oversized or malformed watch declaration', () => {
    expect(parseRealtimeCommand({ id: 'q1', t: 'session.watch', sessionIds: [] })).toEqual({
      kind: 'invalid',
      reason: 'bad_payload',
    })
    expect(parseRealtimeCommand({ id: 'q1', t: 'session.watch' })).toEqual({
      kind: 'invalid',
      reason: 'bad_payload',
    })
    expect(parseRealtimeCommand({ id: 'q1', t: 'session.watch', sessionIds: [''] })).toEqual({
      kind: 'invalid',
      reason: 'bad_payload',
    })
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'session.watch',
        sessionIds: Array.from({ length: 200 }, (_, i) => `s${i}`),
      }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
  })

  it('accepts valid send commands with the same constraints as the HTTP route', () => {
    const command = parseRealtimeCommand({ id: 'q1', t: 'send', sessionId: 's1', prompt: 'hello' })

    expect(command).toEqual({ kind: 'send', sessionId: 's1', body: { prompt: 'hello' } })
  })

  it('threads structured message bindings on the send body', () => {
    const binding = {
      kind: 'context' as const,
      id: 'file-a',
      source: 'mention' as const,
      target: {
        kind: 'file',
        token: '@file:a.ts',
        label: '@file:a.ts',
        attributes: { path: 'a.ts' },
      },
      resolution: { status: 'pending' as const, contributions: [] },
    }
    const command = parseRealtimeCommand({
      id: 'q1',
      t: 'send',
      sessionId: 's1',
      prompt: 'look at @file:a.ts',
      bindings: [binding],
    })
    expect(command).toEqual({
      kind: 'send',
      sessionId: 's1',
      body: {
        prompt: 'look at @file:a.ts',
        bindings: [binding],
      },
    })
  })

  it('rejects a malformed binding or too many bindings', () => {
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'send',
        sessionId: 's1',
        prompt: 'x',
        bindings: [{ kind: 'context', id: '', source: 'mention' }],
      }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'send',
        sessionId: 's1',
        prompt: 'x',
        bindings: Array.from({ length: 21 }, (_, i) => ({
          kind: 'text',
          name: `${i}.txt`,
          text: 'x',
          size: 1,
        })),
      }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
  })

  it('rejects malformed send commands before they reach the service', () => {
    expect(parseRealtimeCommand({ id: 'q1', t: 'send', prompt: 'hello' })).toEqual({
      kind: 'invalid',
      reason: 'bad_payload',
    })
    expect(
      parseRealtimeCommand({ id: 'q1', t: 'send', sessionId: 's1', prompt: '', bindings: [] }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'send',
        sessionId: 's1',
        prompt: 'hello',
        bindings: [{ kind: 'image' }],
      }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
  })

  it('accepts submit-secret and rejects an oversized value WITHOUT echoing it', () => {
    expect(
      parseRealtimeCommand({ id: 'q1', t: 'submit-secret', requestId: 'call_1', value: 'sk-abc' }),
    ).toEqual({ kind: 'submit-secret', body: { requestId: 'call_1', value: 'sk-abc' } })

    // Oversized / malformed values come back as the bare bad_payload marker — the
    // exact-equality asserts prove the rejected value is not echoed anywhere.
    const oversized = 'v'.repeat(SECRET_VALUE_MAX_LENGTH + 1)
    expect(
      parseRealtimeCommand({ id: 'q1', t: 'submit-secret', requestId: 'call_1', value: oversized }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
    expect(parseRealtimeCommand({ id: 'q1', t: 'submit-secret', requestId: 'call_1' })).toEqual({
      kind: 'invalid',
      reason: 'bad_payload',
    })
    expect(
      parseRealtimeCommand({ id: 'q1', t: 'submit-secret', requestId: '', value: 'x' }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
  })

  it('accepts valid interact commands and rejects malformed ones', () => {
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'interact',
        toolCallId: 'tc1',
        action: 'respond',
        payload: { answers: {} },
      }),
    ).toEqual({
      kind: 'interact',
      body: { toolCallId: 'tc1', action: 'respond', payload: { answers: {} } },
    })
    expect(
      parseRealtimeCommand({ id: 'q1', t: 'interact', toolCallId: '', action: 'respond' }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
    expect(parseRealtimeCommand({ id: 'q1', t: 'interact', action: 'respond' })).toEqual({
      kind: 'invalid',
      reason: 'bad_payload',
    })
  })

  it('accepts the canonical multi-surface inline completion command only', () => {
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'inline.complete',
        sessionId: 's1',
        references: [{ kind: 'file', token: '@file:b.ts', label: 'b.ts', origin: 'ambient' }],
        surfaces: {
          chat: {
            draft: 'fix',
            references: [
              {
                kind: 'file',
                token: '@file:src/a.ts',
                label: 'a.ts',
                attributes: { path: 'src/a.ts' },
              },
            ],
          },
          'fixture.commit': { draft: 'feat', repoRoot: '/repo' },
        },
      }),
    ).toEqual({
      kind: 'inline.complete',
      payload: {
        sessionId: 's1',
        references: [{ kind: 'file', token: '@file:b.ts', label: 'b.ts', origin: 'ambient' }],
        surfaces: {
          chat: {
            draft: 'fix',
            references: [
              {
                kind: 'file',
                token: '@file:src/a.ts',
                label: 'a.ts',
                attributes: { path: 'src/a.ts' },
              },
            ],
          },
          'fixture.commit': { draft: 'feat', repoRoot: '/repo' },
        },
      },
    })
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'suggest',
        sessionId: 's1',
        surfaces: { chat: { draft: '' } },
      }),
    ).toMatchObject({ kind: 'unknown', t: 'suggest' })
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'inline.complete',
        sessionId: 's1',
        surfaces: {
          chat: {
            draft: '',
            references: Array.from({ length: COMPLETION_REFERENCE_LIMIT + 1 }, (_, index) => ({
              kind: 'file',
              token: `@file:src/${index}.ts`,
              label: `${index}.ts`,
            })),
          },
        },
      }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
    expect(
      parseRealtimeCommand({
        id: 'q1',
        t: 'inline.complete',
        sessionId: 's1',
        surfaces: {
          chat: {
            draft: '',
            references: [
              {
                kind: 'snippet',
                token: '@snippet:large',
                label: 'large',
                attributes: { content: 'x'.repeat(COMPLETION_INLINE_CONTENT_MAX + 1) },
              },
            ],
          },
        },
      }),
    ).toEqual({ kind: 'invalid', reason: 'bad_payload' })
  })
})

describe('replay gap marker', () => {
  it('is a session frame of this boot carrying the dropped cursor', () => {
    expect(gapFrame('boot-a', '7')).toBe(
      `s\n${encodeSessionCursor('boot-a', '7')}\n\n{"type":"transport.gap"}`,
    )
  })
})
