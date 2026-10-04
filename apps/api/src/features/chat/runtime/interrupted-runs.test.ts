import { describe, expect, test } from 'bun:test'

import {
  RUN_INTERRUPTED_NOTICE,
  announceInterruptedRuns,
  interruptedWithPendingToolNotice,
  pendingToolNames,
} from './interrupted-runs'
import type { PersistedMessage } from '../contracts'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'

/**
 * A run the previous process died in the middle of.
 *
 * The DB was already reconciled — `agent_runs.status='interrupted'` + `error_code='PROCESS_RESTART'`
 * and the session moved out of `running` — and NOTHING read either. So the user came back to an
 * assistant row holding whatever the last flush wrote (cadence 120ms, stretching to 2s) with no
 * error, no spinner, and no way to tell it from a finished reply. These pin the announcement that
 * closes that, including which sessions must stay silent.
 */

interface Inserted {
  messageId: string
  sessionId: string
  userId: string
  content: string
  uiOnly?: boolean
  systemNotice?: { kind: string; tone: string; text: string; recovery?: readonly string[] }
}

function harness(
  opts: { failFor?: string; failMarkOnceFor?: string; history?: PersistedMessage[] } = {},
) {
  const inserted: Inserted[] = []
  const marked: string[] = []
  const persisted = new Map<string, PersistedMessage>()
  let markFailed = false
  const repo = {
    insertMessage: async (input: PersistedMessage) => {
      if (opts.failFor === input.sessionId) throw new Error('disk full')
      persisted.set(input.id, input)
      inserted.push({
        messageId: input.id,
        sessionId: input.sessionId,
        userId: input.userId,
        content: input.payload.content ?? '',
        uiOnly: input.payload.uiOnly,
        systemNotice: input.payload.systemNotice,
      })
    },
    getMessage: async (_userId: string, _sessionId: string, messageId: string) =>
      persisted.get(messageId) ?? null,
    getSession: async () => null,
    listMessages: async () => opts.history ?? [],
  } as unknown as ChatRepository
  const warnings: string[] = []
  return {
    inserted,
    marked,
    warnings,
    deps: {
      repo,
      streamRegistry: { publish: () => {} } as unknown as SessionStreamRegistry,
      now: () => '2026-07-26T12:00:00.000Z',
      markAnnounced: async (runId: string) => {
        if (opts.failMarkOnceFor === runId && !markFailed) {
          markFailed = true
          throw new Error('ack write failed')
        }
        marked.push(runId)
      },
      logger: { warn: (msg: string) => warnings.push(msg) },
    },
  }
}

describe('announceInterruptedRuns', () => {
  test('writes ONE warning notice per interrupted session, whatever its kind', async () => {
    const h = harness()
    const announced = await announceInterruptedRuns(h.deps, [
      { runId: 'r1', sessionId: 's1', userId: 'u1', agentId: 'lead' },
      { runId: 'r2', sessionId: 'job-1', userId: 'u1', agentId: 'lead' },
    ])
    // Every kind is announced: `RuntimeSessionsPanel` renders an explicit "Open" button for
    // subagent/job sessions, and nothing else tells the user a job's run was cut short.
    expect(announced).toBe(2)
    expect(h.inserted.map((row) => row.sessionId)).toEqual(['s1', 'job-1'])
    expect(h.inserted.map((row) => row.messageId)).toEqual(['r1', 'r2'])
    expect(h.marked).toEqual(['r1', 'r2'])
    // `recovery` is the half that makes the notice actionable: the row says the reply is
    // incomplete AND carries the gesture that fixes it, instead of spelling one out in prose
    // the transcript then clamps to a single line.
    expect(h.inserted[0]?.systemNotice).toEqual({
      kind: 'run_interrupted',
      tone: 'warning',
      text: RUN_INTERRUPTED_NOTICE,
      recovery: ['retry'],
    })
    // uiOnly: the note must not enter the model's context, or the next turn narrates the restart.
    expect(h.inserted[0]?.uiOnly).toBe(true)
    // The flat text matters too — both clients fall back to it when a renderer ignores the notice.
    expect(h.inserted[0]?.content).toBe(RUN_INTERRUPTED_NOTICE)
  })

  test('the notice fits an 80-column terminal', () => {
    // A transcript that pads a notice row to the full width and never truncates it hard-wraps a
    // long sentence and desyncs its row accounting. The first version was 116 chars.
    expect(RUN_INTERRUPTED_NOTICE.length).toBeLessThanOrEqual(72)
  })

  test('an unwritable session is logged, not thrown — a note is worth less than a boot', async () => {
    const h = harness({ failFor: 's1' })
    const announced = await announceInterruptedRuns(h.deps, [
      { runId: 'r1', sessionId: 's1', userId: 'u1', agentId: 'lead' },
      { runId: 'r2', sessionId: 's2', userId: 'u1', agentId: 'lead' },
    ])
    expect(announced).toBe(1)
    expect(h.inserted.map((row) => row.sessionId)).toEqual(['s2'])
    expect(h.marked).toEqual(['r2'])
    expect(h.warnings.join(' ')).toContain('s1')
  })

  test('an insert-before-ack retry reuses the run id instead of duplicating the notice', async () => {
    const h = harness({ failMarkOnceFor: 'r1' })
    const run = { runId: 'r1', sessionId: 's1', userId: 'u1', agentId: 'lead' }

    expect(await announceInterruptedRuns(h.deps, [run])).toBe(0)
    expect(h.inserted.map((row) => row.messageId)).toEqual(['r1'])
    expect(h.marked).toEqual([])

    expect(await announceInterruptedRuns(h.deps, [run])).toBe(1)
    expect(h.inserted.map((row) => row.messageId)).toEqual(['r1'])
    expect(h.marked).toEqual(['r1'])
  })

  test('nothing interrupted means nothing written', async () => {
    const h = harness()
    expect(await announceInterruptedRuns(h.deps, [])).toBe(0)
    expect(h.inserted).toEqual([])
  })

  test("in a conversation it names whose reply was cut off, and reads that participant's tools", async () => {
    // It read the session's LAST reply whoever wrote it, so it could warn about a colleague's
    // tool while saying nothing about whose reply was incomplete.
    const reply = (id: string, from: string, handle: string, status: string) =>
      ({
        id,
        payload: {
          id,
          role: 'assistant',
          from,
          authorSnapshot: { handle },
          items: [{ type: 'tool_call', status, name: 'bash' }],
        },
      }) as unknown as PersistedMessage
    const h = harness({
      history: [
        reply('a', 'agent:backend', 'backend', 'running'),
        reply('b', 'agent:qa', 'qa', 'completed'),
      ],
    })
    await announceInterruptedRuns(h.deps, [
      { runId: 'r1', sessionId: 's1', userId: 'u1', agentId: 'backend' },
    ])
    expect(h.inserted[0]?.content).toBe(`@backend: ${interruptedWithPendingToolNotice(['bash'])}`)
  })
})

describe('the notice tells the truth about what was in flight', () => {
  test('a still-running tool call is named, and repeating is not advised blindly', () => {
    const notice = interruptedWithPendingToolNotice(['bash'])

    expect(notice).toContain('bash')
    // "Send again" is safe advice only when nothing outside the process changed. A dispatched
    // bash command may have pushed or deployed, and nothing records whether it did.
    expect(notice).toContain('may or may not have taken effect')
    expect(notice).not.toBe(RUN_INTERRUPTED_NOTICE)
  })

  test('names are de-duplicated and bounded, so the line stays readable', () => {
    const notice = interruptedWithPendingToolNotice(['bash', 'bash', 'write', 'patch', 'read'])
    expect(notice.match(/bash/gu)).toHaveLength(1)
    expect(notice).not.toContain('read')
  })

  test('reads the running calls out of the persisted payload', () => {
    expect(
      pendingToolNames({
        items: [
          { status: 'completed', toolName: 'read' },
          { status: 'running', toolName: 'bash' },
        ],
      }),
    ).toEqual(['bash'])
  })

  test('a payload with nothing running yields the plain notice path', () => {
    expect(pendingToolNames({ items: [{ status: 'completed', toolName: 'read' }] })).toEqual([])
    // Shapes that carry no items at all must not throw — this runs at boot, on every
    // interrupted session, before anything else can go right.
    expect(pendingToolNames({})).toEqual([])
    expect(pendingToolNames(null)).toEqual([])
    expect(pendingToolNames({ items: 'not-an-array' })).toEqual([])
  })

  test('a running item with no usable name contributes nothing rather than an empty mention', () => {
    expect(
      pendingToolNames({ items: [{ status: 'running' }, { status: 'running', name: '' }] }),
    ).toEqual([])
  })
})
