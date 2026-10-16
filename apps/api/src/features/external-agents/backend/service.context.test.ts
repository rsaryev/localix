import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentSessionsService } from './service'
import type { TranscriptSlice } from '../shared/contracts'

/**
 * `context` pulls several sessions into ONE budget, so what one session takes is what the others do
 * not get. A key named twice used to be read twice, rendered twice and charged twice: measured on a
 * real codex session, passing one key three times produced three identical sections and 10,665
 * characters where 3,435 were warranted. Assembling `keys` from two places is the ordinary way that
 * happens, and the cost falls on the other sessions.
 */
function sliceFor(key: string, events: number): TranscriptSlice {
  const [provider, nativeSessionId] = key.split(':')
  return {
    key,
    summary: {
      key,
      provider: provider!,
      nativeSessionId: nativeSessionId!,
      title: `session ${nativeSessionId}`,
      updatedAt: Date.parse('2026-08-03T10:00:00.000Z'),
      sourcePath: `/tmp/${nativeSessionId}.jsonl`,
    },
    events: Array.from({ length: events }, (_, index) => ({
      provider: provider!,
      nativeSessionId: nativeSessionId!,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      ordinal: index,
      text: `turn ${index} ${'detail '.repeat(10)}`,
    })),
    withheld: 0,
    total: events,
  }
}

/** An empty history home: nothing here needs a transcript on disk, and a real scan costs 3.2 s. */
async function service(): Promise<{ svc: AgentSessionsService; reads: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'ea-ctx-home-'))
  const svc = new AgentSessionsService(await mkdtemp(join(tmpdir(), 'ea-ctx-')), () => {}, {
    env: {},
    homeDir: home,
  })
  const reads: string[] = []
  // The one read `context` composes from, stubbed on the real method so the dedupe under test is
  // the shipped one rather than a restatement of it.
  svc.transcript = (async (key: string) => {
    reads.push(key)
    return sliceFor(key, 6)
  }) as AgentSessionsService['transcript']
  return { svc, reads }
}

describe('context reads the END of each session by default', () => {
  /**
   * The ratio is the argument: pulling the five largest sessions of a real history delivered 175 of
   * 23,147 events — 0.76%. At that fraction the end you read is not a detail of the answer, it is the
   * answer, and someone naming five sessions at once is asking where those agents got to. `transcript`
   * keeps its head-first default, because reading ONE session to learn what it was asked is a real
   * use and this is not it.
   */
  test('asks each adapter for the tail, and for the opening only when told', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ea-ctx-home-'))
    const svc = new AgentSessionsService(await mkdtemp(join(tmpdir(), 'ea-ctx-')), () => {}, {
      env: {},
      homeDir: home,
    })
    const asked: (boolean | undefined)[] = []
    svc.transcript = (async (
      key: string,
      _maxEvents?: number,
      _maxCharsPerEvent?: number,
      tail?: boolean,
    ) => {
      asked.push(tail)
      return sliceFor(key, 6)
    }) as AgentSessionsService['transcript']

    await svc.context(['codex:a'])
    await svc.context(['codex:a'], undefined, false)

    expect(asked).toEqual([true, false])
  })
})

describe('context composes one section per session', () => {
  test('a key named several times is read once and charged once', async () => {
    const { svc, reads } = await service()
    const key = 'codex:abc'

    const once = await svc.context([key], 120_000)
    const thrice = await svc.context([key, key, key], 120_000)

    expect(thrice.sections).toHaveLength(1)
    expect(thrice.usedChars).toBe(once.usedChars)
    // Deduped BEFORE the read, so a repeat costs no disk either.
    expect(reads).toEqual([key, key])
  })

  test('every distinct session still appears, deduping drops only the repeat', async () => {
    // The guard must not buy tidiness by dropping anything a caller actually asked for. Section
    // ORDER is not the caller's: `compose` sorts by recency and breaks ties on the key, so the text
    // a model sees is stable across calls. These slices share a timestamp, so the tie-break decides
    // — which is why this asserts the SET, and the sort is asserted where it lives.
    const { svc } = await service()
    const keys = ['codex:a', 'claude-code:b', 'codex:a', 'opencode:c']

    const result = await svc.context(keys, 120_000)

    expect(result.sections.map((section) => section.key).sort()).toEqual([
      'claude-code:b',
      'codex:a',
      'opencode:c',
    ])
  })
})

describe('the sessions are read at once, in the order asked', () => {
  /**
   * Each read enumerates its provider's sources to find the file — 6 ms for the 1,177 Claude Code
   * sessions of a real history, 3 ms for Codex — and serially that repeated once per key. Measured
   * end to end: 136 ms for two sessions and 263 ms for twelve; 124 and 218 once the reads overlap.
   * The reads touch different files and share nothing.
   */
  test('every key is read concurrently rather than one after another', async () => {
    const { svc } = await service()
    let inFlight = 0
    let peak = 0
    svc.transcript = (async (key: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return sliceFor(key, 4)
    }) as AgentSessionsService['transcript']

    await svc.context(['codex:a', 'codex:b', 'codex:c', 'codex:d'], 20_000)

    // Serially this is 1; the point of the change is that it is not.
    expect(peak).toBeGreaterThan(1)
  })

  test('a key named twice is still read once', async () => {
    const { svc, reads } = await service()

    const result = await svc.context(['codex:a', 'codex:b', 'codex:a'], 20_000)

    expect(reads).toEqual(['codex:a', 'codex:b'])
    expect(result.sections).toHaveLength(2)
  })
})
