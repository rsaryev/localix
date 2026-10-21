import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import {
  AGENT_SESSIONS_ACTIONS,
  MAX_SESSION_KEYS,
  agentSessionsProblem,
  buildAgentSessionsSchema,
} from './agent-sessions-schema'
import { runAgentSessions } from './agent-sessions-tool'
import type { AgentSessionsInput } from './agent-sessions-schema'
import type { AgentSessionsService } from '../service'
import type { RosterRow } from '../../shared/contracts'

/**
 * The model-facing surface.
 *
 * Every string here is spent context, and a malformed call answered with a raw validation error
 * costs several turns where a corrective sentence costs one. That is the whole design of
 * `agentSessionsProblem`, and it had no test — so nothing checked that the corrective sentence
 * actually names the fix, or that a VALID call is never refused.
 */
const input = (partial: Partial<AgentSessionsInput> & { action: AgentSessionsInput['action'] }) =>
  partial as AgentSessionsInput

function row(partial: Partial<RosterRow> & { nativeSessionId: string }): RosterRow {
  const { nativeSessionId, ...overrides } = partial
  const provider = overrides.provider ?? 'claude-code'
  return {
    key: `${provider}:${nativeSessionId}`,
    provider,
    nativeSessionId,
    title: 'Fix the parser',
    cwd: '/work/app',
    updatedAt: Date.parse('2026-08-01T10:00:00.000Z'),
    sourcePath: '/tmp/x.jsonl',
    state: 'idle',
    authority: 'none',
    ...overrides,
  }
}

function service(over: Partial<AgentSessionsService> = {}): AgentSessionsService {
  return {
    async roster() {
      return { items: [row({ nativeSessionId: 'abc' })], total: 1, withheld: 0 }
    },
    ...over,
  } as unknown as AgentSessionsService
}

describe('a malformed call is answered with the fix', () => {
  test('an action that needs a key says where to get one', () => {
    for (const action of ['explain', 'transcript', 'resume'] as const) {
      const problem = agentSessionsProblem(input({ action }))
      expect(problem).toContain('roster')
      expect(problem).toContain('key')
    }
  })

  test('a bare native id is refused with the reason, not just rejected', () => {
    // Ids are only unique within a provider, so accepting one would eventually attach an action to
    // the wrong agent's session — the failure this key format exists to prevent.
    const problem = agentSessionsProblem(input({ action: 'transcript', key: 'a1b2c3d4' }))
    expect(problem).toContain('<provider>:<nativeSessionId>')
    expect(problem).toContain('only unique within one provider')
  })

  test('the key list is bounded — each key is a full source walk, run at once', () => {
    const schema = buildAgentSessionsSchema(z)
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `codex:${i}`)
    expect(schema.safeParse({ action: 'context', keys: keys(MAX_SESSION_KEYS) }).success).toBe(true)
    expect(schema.safeParse({ action: 'context', keys: keys(MAX_SESSION_KEYS + 1) }).success).toBe(
      false,
    )
  })

  test('mode "one" with several keys names both alternatives', () => {
    const problem = agentSessionsProblem(
      input({ action: 'wait', mode: 'one', keys: ['a:1', 'b:2'] }),
    )
    expect(problem).toContain('"any"')
    expect(problem).toContain('"all"')
  })

  test('every well-formed call is accepted', () => {
    // The guard must never be the reason a legitimate call fails; each action is checked with the
    // minimum it actually requires.
    const valid: AgentSessionsInput[] = [
      input({ action: 'providers' }),
      input({ action: 'roster' }),
      input({ action: 'stats', days: 30 }),
      input({ action: 'explain', key: 'claude-code:abc' }),
      input({ action: 'transcript', key: 'codex:abc' }),
      input({ action: 'resume', key: 'codex:abc' }),
      input({ action: 'context', keys: ['claude-code:a', 'codex:b'] }),
      input({ action: 'wait', keys: ['claude-code:a'], mode: 'all' }),
    ]
    for (const call of valid) expect(agentSessionsProblem(call)).toBeNull()
    // And every action in the enum is represented above, so a new one cannot slip in untested.
    expect(new Set(valid.map((c) => c.action)).size).toBe(AGENT_SESSIONS_ACTIONS.length)
  })
})

describe('explain takes a reading rather than recalling one', () => {
  test('the live screen is read before the state is explained', async () => {
    // Without this the answer is whatever the model last happened to look at — "blocked as of four
    // minutes ago" reported as "blocked".
    const asked: { key?: string; sessionId?: string | null } = {}
    const svc = service({
      async readScreen(key: string, sessionId: string | null) {
        asked.key = key
        asked.sessionId = sessionId
        return 'Do you want to proceed?'
      },
      async explain() {
        return null
      },
    } as unknown as Partial<AgentSessionsService>)

    await runAgentSessions(svc, input({ action: 'explain', key: 'codex:abc' }), undefined, 's1')
    expect(asked).toEqual({ key: 'codex:abc', sessionId: 's1' })
  })

  test('a host that gave no reader still explains, from what was observed', async () => {
    // The reader is absent on the per-run loads, so explain must never depend on it.
    const svc = service({
      async readScreen() {
        return null
      },
      async explain() {
        return null
      },
    } as unknown as Partial<AgentSessionsService>)
    const result = await runAgentSessions(svc, input({ action: 'explain', key: 'codex:abc' }))
    expect(result.content).toContain('codex:abc')
  })
})

describe('a roster row says what reading it will cost', () => {
  /**
   * This list is how a key gets chosen, and the next call spends context in proportion to the
   * session's size — so reading a 3,000-event session to answer what the 12-event one beside it
   * would have answered is the mistake the row exists to prevent. It carried no size signal at all.
   */
  test('the event count is on the row, and absent rather than zero when unmeasured', async () => {
    const svc = service({
      async roster() {
        return {
          items: [
            row({ nativeSessionId: 'big', messageCount: 2814 }),
            row({ nativeSessionId: 'unmeasured' }),
          ],
          total: 2,
          withheld: 0,
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'roster' }))
    expect(result.content).toContain('2814 events')
    // A session whose size nobody measured is not given a zero.
    expect(result.content).not.toContain('0 events')
  })

  test('a session an orchestrator is waiting on says so', async () => {
    // The workspace row has shown `awaited` since `waitedKeys` existed; the model, which is the half
    // that issues waits, could not see it.
    const svc = service({
      async roster() {
        return {
          items: [row({ nativeSessionId: 'watched', awaited: true, terminalId: 't1' })],
          total: 1,
          withheld: 0,
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'roster' }))
    expect(result.content).toContain('live · awaited')
  })

  test('an idle that no rule confirmed is not reported as a plain idle', async () => {
    // `idle` is the state a caller acts on by STOPPING, and claude-code's manifest cannot produce
    // `working` at all — so an unmarked `idle` invites exactly the wrong conclusion. The mark rides
    // on the row rather than costing an `explain` call per row to discover.
    const svc = service({
      async roster() {
        return {
          items: [
            row({ nativeSessionId: 'busy', state: 'idle', stateFallback: true, terminalId: 't1' }),
          ],
          total: 1,
          withheld: 0,
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'roster' }))
    expect(result.content).toContain('idle · live · unconfirmed')
  })
})

describe('a withheld transcript names where to continue', () => {
  /**
   * It offered the other END only, which for a long session is not enough — 8,596 events with 2,000
   * shown leaves thousands that neither end reaches. Verified against that session: a head read of 5
   * answers `continue with from: 5`, a tail read `from: 8743`, and a `from: 4000` read `from: 4005`.
   */
  function sliced(over: Record<string, unknown>) {
    return service({
      async transcript() {
        return {
          key: 'codex:a',
          summary: {
            key: 'codex:a',
            provider: 'codex',
            nativeSessionId: 'a',
            title: 'session',
            updatedAt: 0,
            sourcePath: '/tmp/a.jsonl',
          },
          events: [10, 11, 12].map((ordinal) => ({
            provider: 'codex',
            nativeSessionId: 'a',
            role: 'assistant' as const,
            ordinal,
            text: `event ${ordinal}`,
          })),
          withheld: 97,
          total: 100,
          ...over,
        }
      },
    } as Partial<AgentSessionsService>)
  }

  test('a forward read says the next position, and the other end as well', async () => {
    const result = await runAgentSessions(
      sliced({}),
      input({ action: 'transcript', key: 'codex:a' }),
    )

    expect(result.content).toContain('continue with from: 13')
    expect(result.content).toContain('tail:true')
  })

  test('a tail read points BACKWARDS, since forward of it there is nothing', async () => {
    const result = await runAgentSessions(
      sliced({}),
      input({ action: 'transcript', key: 'codex:a', tail: true }),
    )

    expect(result.content).toContain('continue with from: 7')
    expect(result.content).not.toContain('tail:true)')
  })

  test('a window that began at a position says so, rather than "the start"', async () => {
    const result = await runAgentSessions(
      sliced({}),
      input({ action: 'transcript', key: 'codex:a', from: 10 }),
    )

    expect(result.content).toContain('from position 10')
    expect(result.content).not.toContain('from the start')
  })
})

describe('a row says when a screen has gone still', () => {
  /**
   * Five minutes is Symphony's own stall default (SPEC.md:633). Below it the mark would appear on every
   * healthy delegation — a screen redraws between turns — and a mark a reader sees always is a mark
   * they stop reading.
   */
  function withRow(over: Record<string, unknown>) {
    return service({
      async roster() {
        return {
          items: [row({ nativeSessionId: 'live', terminalId: 't1', state: 'idle', ...over })],
          total: 1,
          withheld: 0,
        }
      },
    } as Partial<AgentSessionsService>)
  }

  test('a screen still for longer than the floor is called out, in minutes', async () => {
    const svc = withRow({ lastChangeAt: Date.now() - 12 * 60_000 })

    const result = await runAgentSessions(svc, input({ action: 'roster' }))

    expect(result.content).toContain('unchanged for 12m')
  })

  test('a screen that moved recently says nothing', async () => {
    const svc = withRow({ lastChangeAt: Date.now() - 30_000 })

    const result = await runAgentSessions(svc, input({ action: 'roster' }))

    expect(result.content).not.toContain('unchanged for')
  })

  test('a historical row is never called still, having no screen to watch', async () => {
    const svc = service({
      async roster() {
        return {
          items: [row({ nativeSessionId: 'old', lastChangeAt: Date.now() - 3 * 3_600_000 })],
          total: 1,
          withheld: 0,
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'roster' }))

    expect(result.content).not.toContain('unchanged for')
  })
})

describe('the model half can drill by project too', () => {
  /**
   * `cwdPrefix` was declared, validated and implemented while nothing sent one; the workspace drills
   * by project now, and this is the other half. Verified on real data: the same prefix takes the
   * statistics answer from 282 sessions across 21 projects to 151 across 1.
   */
  test('roster passes the prefix through as a filter, not as free text', async () => {
    let seen: unknown
    const svc = service({
      async roster(query) {
        seen = query
        return { items: [], total: 0, withheld: 0 }
      },
    } as Partial<AgentSessionsService>)

    await runAgentSessions(svc, input({ action: 'roster', cwdPrefix: '/work/app' }))

    expect(seen).toMatchObject({ cwdPrefix: '/work/app' })
    // Never smuggled into `text`, which matches title, provider and id as well.
    expect((seen as { text?: string }).text).toBeUndefined()
  })

  test('stats passes it too, so both answers narrow together', async () => {
    let seen: unknown
    const svc = service({
      async stats(query) {
        seen = query
        return {
          sessions: 0,
          messages: 0,
          usageSessions: 0,
          projects: 0,
          firstAt: undefined,
          lastAt: undefined,
          medianDurationMs: undefined,
          byProvider: [],
          byProject: [],
          byModel: [],
          byParent: [],
          topSessions: [],
          byDay: [],
          outsideRange: [],
          activeDays: 0,
          bucketDays: 1,
        }
      },
    } as Partial<AgentSessionsService>)

    await runAgentSessions(svc, input({ action: 'stats', cwdPrefix: '/work/app' }))

    expect(seen).toMatchObject({ cwdPrefix: '/work/app' })
  })

  test('an absent prefix is not sent as an empty one', async () => {
    let seen: Record<string, unknown> = {}
    const svc = service({
      async roster(query) {
        seen = query as Record<string, unknown>
        return { items: [], total: 0, withheld: 0 }
      },
    } as Partial<AgentSessionsService>)

    await runAgentSessions(svc, input({ action: 'roster' }))

    expect('cwdPrefix' in seen).toBe(false)
  })
})

describe('a position reaches the middle of a session', () => {
  /**
   * Head and tail together leave the middle of every session past the 2,000-event cap unreachable.
   */
  test('"from" and "tail" ask for opposite things and are refused with the fix', async () => {
    const svc = service({} as Partial<AgentSessionsService>)

    const result = await runAgentSessions(
      svc,
      input({ action: 'transcript', key: 'codex:a', from: 100, tail: true }),
    )

    expect(result.content).toContain('opposite things')
    expect(result.content).toContain('Drop "tail"')
  })

  test('"from" on an action with no positions says so rather than being ignored', async () => {
    const svc = service({} as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'roster', from: 10 }))

    expect(result.content).toContain('applies to "transcript" only')
  })
})

describe('the stats answer says how much of the range is empty', () => {
  test('the headline counts active days, not the range length', async () => {
    // A reader dividing a total by "the last 90 days" is out by a wide factor when only some of
    // those days hold anything.
    const svc = service({
      async stats() {
        return {
          sessions: 197,
          messages: 4000,
          usageSessions: 180,
          projects: 9,
          firstAt: Date.now() - 200 * 86_400_000,
          lastAt: Date.now(),
          medianDurationMs: 60_000,
          byProvider: [],
          byProject: [],
          byModel: [],
          byParent: [],
          topSessions: [],
          byDay: [],
          outsideRange: [],
          activeDays: 37,
          bucketDays: 90,
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'stats', days: 90 }))

    expect(result.content).toContain('197 session(s) over 37 active day(s) of the last 90')
  })
})

describe('the stats answer names the agents its range hides', () => {
  /**
   * The same blindness the workspace used to have: `By agent` listed only the providers active in
   * the range, and a model reading it concludes the others have no history. The figure comes from
   * the fold, so the screen and this answer cannot disagree.
   */
  test('the excluded agents are listed with a days suggestion that reaches them', async () => {
    const day = 86_400_000
    const now = Date.now()
    const svc = service({
      async stats() {
        return {
          sessions: 5,
          messages: 40,
          usageSessions: 0,
          projects: 1,
          firstAt: now - 200 * day,
          lastAt: now,
          medianDurationMs: 1000,
          byProvider: [{ key: 'codex', sessions: 5, updatedAt: now }],
          byProject: [],
          byModel: [],
          byParent: [],
          topSessions: [],
          byDay: [],
          activeDays: 1,
          bucketDays: 30,
          outsideRange: [
            { key: 'github-copilot', sessions: 34, updatedAt: now - 54.2 * day },
            { key: 'hermes', sessions: 19, updatedAt: now - 90 * day },
          ],
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'stats' }))

    expect(result.content).toContain('github-copilot (34), hermes (19)')
    expect(result.content).toContain('53 session(s) with nothing in the window')
    // Rounded UP to the newest excluded session, so one call reaches it rather than landing short.
    expect(result.content).toContain('days: 55')
  })

  test('a range that excludes nothing says nothing', async () => {
    const svc = service({
      async stats() {
        return {
          sessions: 1,
          messages: 1,
          usageSessions: 0,
          projects: 1,
          firstAt: Date.now(),
          lastAt: Date.now(),
          medianDurationMs: 0,
          byProvider: [],
          byProject: [],
          byModel: [],
          byParent: [],
          topSessions: [],
          byDay: [],
          activeDays: 1,
          bucketDays: 30,
          outsideRange: [],
        }
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'stats' }))

    expect(result.content).not.toContain('Outside this range')
  })
})

describe('the stats answer carries what the screen leads with', () => {
  /**
   * The providers record per-request token usage and we read it, but this answer reported session
   * COUNTS alone — no tokens, and no model axis at all, while the workspace screen leads with both.
   * A model asking where the work went got the shape and none of the weight.
   */
  const usage = {
    inputTokens: 420_000,
    cachedInputTokens: 1_200_000,
    cacheWriteTokens: 80_000,
    outputTokens: 75_000,
    reasoningTokens: 12_000,
    totalTokens: 1_775_000,
    requests: 46,
    byModel: [],
    byDay: [],
  }
  const bucket = (key: string, sessions: number) => ({ key, sessions, updatedAt: 0, usage })
  const statsService = () =>
    service({
      async stats() {
        return {
          sessions: 12,
          projects: 20,
          usage,
          usageSessions: 11,
          firstAt: Date.parse('2026-07-01T00:00:00Z'),
          lastAt: Date.parse('2026-08-03T00:00:00Z'),
          byProvider: [bucket('claude-code', 12)],
          byProject: Array.from({ length: 12 }, (_, i) => bucket(`/work/p${i}`, 1)),
          topSessions: [{ ...bucket('claude-code:heavy', 1), label: 'Optimise the animation' }],
          byModel: Array.from({ length: 23 }, (_, i) => bucket(`model-${i}`, 1)),
          byParent: [],
          byDay: [],
          outsideRange: [],
          activeDays: 1,
          bucketDays: 1,
        }
      },
    } as unknown as Partial<AgentSessionsService>)

  test('tokens are reported, and named as the measure they are', async () => {
    const result = await runAgentSessions(statsService(), input({ action: 'stats' }))
    // "processed" because the figure includes cache re-reads, where core's identically-named total
    // does not — the same distinction the screen's tile makes.
    expect(result.content).toContain('1.8M tokens processed (cache re-reads included; 495k fresh')
    expect(result.content).toContain('measured for 11 of 12 session(s)')
    expect(result.content).toContain('claude-code: 12 session(s) · 1.8M tokens')
  })

  test('the model axis exists, and both axis caps say what they dropped', async () => {
    const result = await runAgentSessions(statsService(), input({ action: 'stats' }))
    expect(result.content).toContain('By model (top 8 of 23):')
    // The project slice was a bound that said nothing; every other bound here states itself.
    expect(result.content).toContain('By project (top 8 of 20):')
    // Every other axis aggregates; this is the only one that names individual runs, and it prints the
    // key because that is what the next call takes.
    expect(result.content).toContain('Heaviest sessions:')
    expect(result.content).toContain('claude-code:heavy')
  })

  test('a provider that measured nothing is not given a zero', async () => {
    // A bare "0 tokens" reads as a measurement. Absent stays absent.
    const noUsage = service({
      async stats() {
        return {
          sessions: 2,
          projects: 1,
          usageSessions: 0,
          byProvider: [{ key: 'gemini-cli', sessions: 2, updatedAt: 0 }],
          byProject: [{ key: '/work/a', sessions: 2, updatedAt: 0 }],
          // Nothing measured, so nothing to rank — the axis must disappear, not print a heading.
          topSessions: [],
          byModel: [],
          byParent: [],
          byDay: [],
          outsideRange: [],
          activeDays: 1,
          bucketDays: 1,
        }
      },
    } as unknown as Partial<AgentSessionsService>)
    const result = await runAgentSessions(noUsage, input({ action: 'stats' }))
    expect(result.content).toContain('gemini-cli: 2 session(s)')
    expect(result.content).not.toContain('tokens')
    expect(result.content).not.toContain('By model')
    expect(result.content).not.toContain('Heaviest sessions')
  })
})

describe('a transcript names its tools and shows what they were called with', () => {
  /**
   * This renderer labelled every event by ROLE alone, so a result read `**tool**: <output>` with
   * nothing saying what ran, and a call read `**assistant**: Bash` — the adapters' placeholder text,
   * which is the tool's own name. The arguments, which every adapter records, were dropped entirely.
   */
  const slice = {
    key: 'claude-code:abc',
    summary: {
      key: 'claude-code:abc',
      provider: 'claude-code',
      nativeSessionId: 'abc',
      title: 'Fix the parser',
      updatedAt: 0,
      sourcePath: '/tmp/abc.jsonl',
    },
    events: [
      {
        provider: 'claude-code',
        nativeSessionId: 'abc',
        role: 'assistant' as const,
        ordinal: 0,
        text: 'Bash',
        toolName: 'Bash',
        toolCallId: 'call-1',
        toolInput: { command: 'bun test' },
      },
      {
        provider: 'claude-code',
        nativeSessionId: 'abc',
        role: 'tool' as const,
        ordinal: 1,
        text: '3 pass',
        toolCallId: 'call-1',
      },
    ],
    withheld: 0,
    total: 2,
  }

  const withTranscript = () =>
    service({
      async transcript() {
        return slice
      },
    } as unknown as Partial<AgentSessionsService>)

  test('a result is labelled with the tool its call named', async () => {
    const result = await runAgentSessions(
      withTranscript(),
      input({ action: 'transcript', key: 'claude-code:abc' }),
    )
    expect(result.content).toContain('**tool:Bash**: 3 pass')
    expect(result.content).not.toContain('**tool**: 3 pass')
  })

  test('a call shows its arguments instead of repeating its own name', async () => {
    const result = await runAgentSessions(
      withTranscript(),
      input({ action: 'transcript', key: 'claude-code:abc' }),
    )
    expect(result.content).toContain('**assistant:Bash**: {"command":"bun test"}')
  })
})

describe('what the model is handed back', () => {
  test('a roster row carries the key, and the key is what other actions take', async () => {
    const result = await runAgentSessions(service(), input({ action: 'roster' }))
    expect(result.content).toContain('claude-code:abc')
    expect(result.content).toContain('Fix the parser')
  })

  test('an empty roster points at the next call instead of just saying nothing', async () => {
    const empty = service({
      async roster() {
        return { items: [], total: 0, withheld: 0 }
      },
    } as Partial<AgentSessionsService>)
    const result = await runAgentSessions(empty, input({ action: 'roster' }))
    expect(result.content).toContain('providers')
  })

  test('a bounded roster states the shortfall and how to narrow it', async () => {
    // Silently returning the first N is the failure the Bounded contract exists to prevent.
    const many = service({
      async roster() {
        return { items: [row({ nativeSessionId: 'abc' })], total: 400, withheld: 399 }
      },
    } as Partial<AgentSessionsService>)
    const result = await runAgentSessions(many, input({ action: 'roster' }))
    expect(result.content).toContain('399')
    expect(result.content).toMatch(/narrow|offset/i)
  })

  test('the problem is answered before any work is done', async () => {
    let touched = false
    const spy = service({
      async roster() {
        touched = true
        return { items: [], total: 0, withheld: 0 }
      },
    } as Partial<AgentSessionsService>)
    const result = await runAgentSessions(spy, input({ action: 'transcript' }))
    expect(result.content).toContain('roster')
    expect(touched).toBe(false)
  })
})

describe('the tool prints the fan-out its own schema points at', () => {
  /**
   * `parentKey`'s description tells a caller to read keys off `stats` — and `stats` printed none,
   * because the axis was added to the workspace and not here. An orchestrator's most direct
   * question, what did this run spawn and can I list it, was answerable only from a screen it
   * cannot see.
   */
  function statsWith(byParent: unknown[]) {
    return service({
      async stats() {
        return {
          sessions: 3,
          messages: 30,
          usageSessions: 0,
          projects: 1,
          firstAt: Date.now() - 86_400_000,
          lastAt: Date.now(),
          medianDurationMs: 60_000,
          byProvider: [{ key: 'claude-code', sessions: 3, messages: 30, updatedAt: Date.now() }],
          byProject: [],
          byModel: [],
          byParent,
          topSessions: [],
          byDay: [],
          activeDays: 1,
          bucketDays: 1,
          outsideRange: [],
        } as never
      },
    } as Partial<AgentSessionsService>)
  }

  test('each parent is named with its key and its child count', async () => {
    const result = await runAgentSessions(
      statsWith([
        {
          key: 'claude-code:p1',
          label: 'the orchestrator',
          sessions: 208,
          updatedAt: Date.now(),
        },
      ]),
      input({ action: 'stats' }),
    )

    expect(result.content).toContain('claude-code:p1')
    expect(result.content).toContain('208 sub-agent(s)')
    // The key is only useful if the caller is told what to do with it.
    expect(result.content).toContain('parent_key')
  })

  test('nothing delegated means no heading, rather than an empty one', async () => {
    const result = await runAgentSessions(statsWith([]), input({ action: 'stats' }))

    expect(result.content).not.toContain('Most delegating')
  })
})

describe('every axis the statistics carry reaches the model half too', () => {
  /**
   * The fan-out axis existed on the workspace for two iterations before it existed here, and the
   * filter that consumes its keys shipped in between — so the tool's own schema pointed a caller at
   * an output that did not contain it. A person can see a bar; an orchestrator can only read this.
   *
   * Each axis is given a key nothing else would produce, and the answer has to contain all of them.
   */
  const MARKED = {
    sessions: 5,
    messages: 50,
    usageSessions: 0,
    projects: 1,
    firstAt: Date.now() - 86_400_000,
    lastAt: Date.now(),
    medianDurationMs: 60_000,
    byProvider: [{ key: 'axis-provider', sessions: 5, messages: 50, updatedAt: Date.now() }],
    byProject: [{ key: '/axis-project', sessions: 5, messages: 50, updatedAt: Date.now() }],
    byModel: [{ key: 'axis-model', sessions: 5, messages: 50, updatedAt: Date.now() }],
    byParent: [{ key: 'axis-parent', label: 'parent', sessions: 7, updatedAt: Date.now() }],
    topSessions: [
      {
        key: 'axis-session',
        label: 'session',
        sessions: 1,
        updatedAt: Date.now(),
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
          totalTokens: 11,
          requests: 1,
        },
      },
    ],
    byDay: [],
    activeDays: 1,
    bucketDays: 1,
    outsideRange: [],
  }

  test('each axis appears in the answer, by a key only it could have produced', async () => {
    const svc = service({
      async stats() {
        return MARKED as never
      },
    } as Partial<AgentSessionsService>)

    const result = await runAgentSessions(svc, input({ action: 'stats' }))

    for (const marker of [
      'axis-provider',
      '/axis-project',
      'axis-model',
      'axis-parent',
      'axis-session',
    ]) {
      expect(result.content, `${marker} is folded but never printed`).toContain(marker)
    }
  })
})

describe('native continuation', () => {
  test('returns the exact command and requires opening a terminal before claiming success', async () => {
    let key: string | undefined
    const result = await runAgentSessions(
      service({
        async resume(requested) {
          key = requested
          return {
            resume: { providerName: 'Codex', command: "cd -- '/work/app' && codex resume 'abc'" },
          }
        },
      }),
      input({ action: 'resume', key: 'codex:abc' }),
    )
    expect(key).toBe('codex:abc')
    expect(result.content).toContain('"action":"open"')
    expect(result.content).toContain("cd -- '/work/app' && codex resume 'abc'")
    expect(result.content).toContain('has not opened a terminal')
  })

  test('does not invent continuation for missing sessions or unsupported adapters', async () => {
    for (const resume of [null, { resume: undefined }]) {
      const result = await runAgentSessions(
        service({
          async resume() {
            return resume
          },
        }),
        input({ action: 'resume', key: 'hermes:abc' }),
      )
      expect(result.content).not.toContain('"action":"open"')
      expect(result.content).toContain(resume ? 'not supported' : 'No session on disk')
    }
  })
})
