import { DEFAULT_AGENT_PARTICIPANT } from '../../../../db'
import { describe, expect, test } from 'bun:test'

import { createSecretExposureShield } from '../../../secrets/exposure-shield'
import { createItemAccumulator } from '../items'
import { emptyAssistantPayload } from '../message-envelope'
import { emptySessionTiming } from '../../session-timing'
import { createRunTurnState } from './turn-state'
import { handleToolExecutionStart, handleToolExecutionUpdate } from './event-handlers-tools'
import type { TurnEventContext } from './event-handlers'

/**
 * The SEAM that was untested: the shield is unit-tested in isolation and the loop is
 * tested against a hand-written fake sanitizer, so nothing pinned the composition —
 * `bootstrap → sanitizeToolInput → the event handler → the persisted item`. Both defects it was
 * asked about lived exactly there:
 *
 *   - a tool call's ARGUMENTS were never shielded while its result always was, so a `bash`
 *     invocation carrying an inline credential was persisted into `agent_messages` verbatim and
 *     streamed to every connected client;
 *   - `onUpdate` fires inside `execute`, BEFORE the result boundary, so streaming progress reached
 *     the item unshielded even when the final result would have redacted the same bytes.
 *
 * These drive the real handlers with the REAL shield, and assert on what lands in the item.
 *
 * A later review found the seam was one layer too high: the handlers are not the FIRST writer of a
 * tool's arguments. The second describe block below covers the writer that is.
 */

const SECRET = 'sk-live-abcdef123456'

type Acc = ReturnType<typeof createItemAccumulator>
const toolItem = (acc: Acc, toolCallId: string) =>
  acc.list().find((item) => 'toolCallId' in item && item.toolCallId === toolCallId) as
    | { input?: unknown; details?: unknown }
    | undefined
const toolInput = (acc: Acc, id: string) => toolItem(acc, id)?.input
/** The whole projected item — a bash call becomes a `command` item, so the streamed output lands
 *  in the projection's own fields rather than under `details`. What persists is this object. */
const itemJson = (acc: Acc, id: string) => JSON.stringify(toolItem(acc, id))

function harness(opts: { shielded: boolean }) {
  const shield = createSecretExposureShield()
  shield.remember('u1', SECRET)
  // Wired exactly as `stages/stream.ts` does, because the accumulator — not the event handler — is the
  // FIRST writer of a tool's arguments.
  const acc = createItemAccumulator(() => 'Running', {
    sanitize: opts.shielded ? (value) => shield.redactValue('u1', value) : undefined,
  })
  const state = createRunTurnState({
    payload: emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
    assistantCreatedAt: '2026-07-26T00:00:00.000Z',
    baseSessionTiming: emptySessionTiming(),
  })
  const published: unknown[] = []
  const ctx = {
    userId: 'u1',
    session: { id: 's1', userId: 'u1' },
    assistantMessageId: 'a1',
    state,
    acc,
    env: {
      state: { stoppedRuntimeSessionIds: new Set<string>() },
      // The publish sink is the only stub: this test is about WHAT gets written, not about the
      // flush cadence, and the real persistence needs a DB.
      persistAndPublish: async () => ({}),
      deps: {
        streamRegistry: {
          publish: (_u: string, _s: string, event: unknown) => published.push(event),
          hasWatchers: () => false,
        },
        ...(opts.shielded
          ? {
              sanitizeToolInput: (userId: string, value: unknown) =>
                shield.redactValue(userId, value),
            }
          : {}),
      },
    },
  } as unknown as TurnEventContext
  return { ctx, state, acc, published }
}

describe('a tool call shows shielded arguments, never the executed ones', () => {
  test('an inline credential in a bash command never reaches the item', async () => {
    const h = harness({ shielded: true })
    await handleToolExecutionStart(h.ctx, {
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      input: { command: `curl -H "X-Api-Key: ${SECRET}" https://api.example.com` },
    } as never)

    const shown = toolInput(h.acc, 'c1') as { command: string }
    expect(shown.command).not.toContain(SECRET)
    expect(shown.command).toContain('https://api.example.com')
  })

  test('the same call is UNSHIELDED without the dep — this is the defect, pinned', async () => {
    // Guards against the wiring being dropped: with no `sanitizeToolInput` the secret is persisted
    // verbatim, which is exactly the behaviour that shipped before this seam existed.
    const h = harness({ shielded: false })
    await handleToolExecutionStart(h.ctx, {
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      input: { command: `echo ${SECRET}` },
    } as never)
    const shown = toolInput(h.acc, 'c1') as { command: string }
    expect(shown.command).toContain(SECRET)
  })

  test('streaming progress details are shielded too, before the result boundary', async () => {
    const h = harness({ shielded: true })
    h.ctx.state.pendingTools.set('c1', { name: 'bash', input: {} })
    h.acc.startTool(0, 'c1', 'bash', { command: 'run' })
    await handleToolExecutionUpdate(h.ctx, {
      // BOTH keys, because two tools stream two different shapes: `output` is what
      // `bash-run.ts` emits and what the `command` projection persists, while `content` is
      // what a sub-agent narrates. A review caught the first version asserting only on
      // `content`, which the `command` projection drops — so the item check passed even
      // unshielded.
      type: 'tool_execution_update',
      toolCallId: 'c1',
      details: {
        command: 'run',
        output: `token=${SECRET}\nstill running`,
        content: `token=${SECRET}\nstill running`,
      },
    } as never)
    const item = toolItem(h.acc, 'c1') as { output?: string }
    expect(item.output).toBeDefined()
    expect(item.output).not.toContain(SECRET)
    expect(item.output).toContain('still running')
    expect(itemJson(h.acc, 'c1')).not.toContain(SECRET)
  })

  test('the pending record the summary reads carries the shielded copy', async () => {
    // `pendingTools` feeds the run summary, so an unshielded copy there would leak by a
    // second route even with the item clean.
    const h = harness({ shielded: true })
    await handleToolExecutionStart(h.ctx, {
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      input: { command: `echo ${SECRET}` },
    } as never)
    expect(JSON.stringify(h.ctx.state.pendingTools.get('c1'))).not.toContain(SECRET)
  })
})

/**
 * The ORDER a review proved wrong in the first version of this fix.
 *
 * The loop emits `message_end` with the final assistant message BEFORE it emits any
 * `tool_execution_start` (`packages/engine-loop/src/turn.ts`), and `message_end` runs `syncAssistantParts` → `acc.streamTool`,
 * which takes `input` straight from `toolCall.arguments`. So the FIRST persisted + streamed copy of a
 * command is written by that path, not by the shielded handler — the handler only overwrote it on a
 * later flush, and if the run aborted in between, the raw value was what stayed in `agent_messages`.
 */
describe('the FIRST writer of a tool call shields it too', () => {
  const rawCall = {
    id: 'c1',
    name: 'bash',
    arguments: { command: `PGPASSWORD=${SECRET} psql -h db` },
  }

  test('the arguments recorded by message_end never carry the credential', () => {
    const h = harness({ shielded: true })
    // What `syncAssistantParts` does for a tool_call part, verbatim.
    h.acc.streamTool(0, { ...rawCall, contentIndex: 0 })
    const shown = toolInput(h.acc, 'c1') as { command: string }
    expect(shown.command).not.toContain(SECRET)
    expect(shown.command).toContain('psql -h db')
  })

  test('without the sanitizer the same call is raw — the defect, pinned at ITS writer', () => {
    const h = harness({ shielded: false })
    h.acc.streamTool(0, { ...rawCall, contentIndex: 0 })
    expect((toolInput(h.acc, 'c1') as { command: string }).command).toContain(SECRET)
  })

  test('a later handler cannot un-shield it, and an omitted field keeps the shielded value', () => {
    const h = harness({ shielded: true })
    h.acc.streamTool(0, { ...rawCall, contentIndex: 0 })
    // A status-only patch must not resurrect anything: `input` is absent from the patch, so the
    // stored (shielded) value is kept rather than replaced or cleared.
    h.acc.endTool('c1', 'bash', { status: 'completed' })
    expect(itemJson(h.acc, 'c1')).not.toContain(SECRET)
    expect((toolInput(h.acc, 'c1') as { command: string }).command).toContain('psql -h db')
  })
})
