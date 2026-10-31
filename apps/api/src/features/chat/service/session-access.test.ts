import { describe, expect, test } from 'bun:test'
import {
  assertMutableChatSession,
  assertSessionNotBusy,
  assertUserWritableSession,
  findToolItemByCallId,
  toSourceRuntime,
} from './session-access'
import { ApiError } from '../../../lib/errors'
import type { SessionRecord } from '../repository'
import type { PersistedMessage } from '../contracts'
import type { AgentItem, ToolCallItem } from '@localixai/agent/agents'
import { DEFAULT_AGENT_AUTHOR } from '../../../db'

// The session mutation lock IS `lib/keyed-serializer.ts` (keyed by sessionId); its
// FIFO / key-independence / no-poison contract is covered by keyed-serializer.test.ts.

describe('assertMutableChatSession', () => {
  const session = (kind: SessionRecord['sessionKind']) => ({ sessionKind: kind }) as SessionRecord
  test('passes for a chat session, rejects runtime sessions', () => {
    expect(() => assertMutableChatSession(session('chat'))).not.toThrow()
    expect(() => assertMutableChatSession(session('subagent'))).toThrow(/read-only/)
    expect(() => assertMutableChatSession(session('job'))).toThrow(/read-only/)
  })
})

describe('assertUserWritableSession', () => {
  const delegation = { kind: 'task-delegation', parentSessionId: 'root', toolCallId: 'tc' }
  const session = (
    kind: SessionRecord['sessionKind'],
    extra: Partial<SessionRecord> = {},
  ): SessionRecord =>
    ({ sessionKind: kind, provenance: { kind: 'root' }, closedAt: null, ...extra }) as SessionRecord

  test('allows direct user turns in chats and in open delegated children', () => {
    expect(() => assertUserWritableSession(session('chat'))).not.toThrow()
    // The composer in a child's chat was enabled while the server bounced every message back as
    // read-only; a child now takes the person's messages like its delegator's.
    expect(() =>
      assertUserWritableSession(session('subagent', { provenance: delegation } as never)),
    ).not.toThrow()
  })

  test('refuses a closed child, and the runtime kinds nobody converses with', () => {
    expect(() =>
      assertUserWritableSession(
        session('subagent', { provenance: delegation, closedAt: '2026-10-01' } as never),
      ),
    ).toThrow(/closed/)
    expect(() => assertUserWritableSession(session('job'))).toThrow(/read-only/)
    expect(() => assertUserWritableSession(session('system'))).toThrow(/read-only/)
  })
})

const toolMsg = (items: AgentItem[]): PersistedMessage => ({
  id: 'm',
  sessionId: 's',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  payload: { id: 'm', role: 'assistant', from: DEFAULT_AGENT_AUTHOR, items },
})

/**
 * A real `ToolCallItem` — no cast. These fields already ARE the whole contract, and the old
 * `as unknown as AgentItem` widened the fixture to the union's TOP type, which is precisely
 * what `toSourceRuntime` (it takes `ToolBackedItem | null`) does not accept. Casting a valid
 * instance to a type its consumer rejects is the fixture lying about what it is.
 */
const tool = (toolCallId: string, name: string, input?: unknown): ToolCallItem => ({
  id: toolCallId,
  status: 'completed',
  type: 'tool_call',
  toolCallId,
  name,
  input,
  activeVerb: 'x',
})

// `assertSessionNotBusy` is the ONE gate every macro / context-mutating / new-run
// command funnels through (command-handlers.ts /clear + siblings, plugin + skill
// commands, edit/rollback/fork in branching-ops, the continuation
// turn). It must reject on the SAME busy predicate the run loop uses — `isBusy`
// (activeRuns OR drainingSessions) — not the weaker `isRunning` (activeRuns only),
// which is blind to the DRAIN WINDOW.
describe('assertSessionNotBusy', () => {
  test('rejects during the DRAIN WINDOW (isBusy true, isRunning false)', () => {
    // A wake sets drainingSessions synchronously but only sets activeRuns several
    // awaits later. In that gap isRunning reads idle while a run is provably about
    // to start, so gating on isRunning let a macro (/clear) slip through and write a
    // bare context boundary CONCURRENTLY with the starting run. The gate must read
    // isBusy so it rejects in exactly this window.
    const runner = { isRunning: () => false, isBusy: () => true }
    let thrown: unknown
    try {
      assertSessionNotBusy(runner, 's1', 'Session is busy — stop the current run first')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ApiError)
    expect((thrown as ApiError).code).toBe('session_busy')
  })

  test('rejects when a run is active', () => {
    expect(() => assertSessionNotBusy({ isRunning: () => true, isBusy: () => true }, 's1')).toThrow(
      ApiError,
    )
  })

  test('allows when genuinely idle (neither running nor draining)', () => {
    expect(() =>
      assertSessionNotBusy({ isRunning: () => false, isBusy: () => false }, 's1'),
    ).not.toThrow()
  })

  test('falls back to isRunning for a narrow test double lacking isBusy', () => {
    // Narrow-parameter tolerance so doubles that predate isBusy still gate.
    expect(() => assertSessionNotBusy({ isRunning: () => true }, 's1')).toThrow(ApiError)
    expect(() => assertSessionNotBusy({ isRunning: () => false }, 's1')).not.toThrow()
  })
})

describe('findToolItemByCallId', () => {
  test('finds the matching tool item across messages, else null', () => {
    const msgs = [toolMsg([tool('t1', 'Bash')]), toolMsg([tool('t2', 'Read')])]
    expect(findToolItemByCallId(msgs, 't2')?.name).toBe('Read')
    expect(findToolItemByCallId(msgs, 'nope')).toBeNull()
  })
})

describe('toSourceRuntime', () => {
  test('null tool item → null', () => {
    expect(toSourceRuntime('t', null)).toBeNull()
  })
  test('bash maps command/cwd/description/background', () => {
    const item = tool('t', 'Bash', {
      command: 'ls',
      cwd: '/w',
      description: 'list',
      background: true,
    })
    expect(toSourceRuntime('t', item)).toMatchObject({
      toolName: 'Bash',
      command: 'ls',
      cwd: '/w',
      description: 'list',
      isBackground: true,
    })
  })
  test('other tools map name + id only', () => {
    expect(toSourceRuntime('t', tool('t', 'Edit', { path: 'a' }))).toEqual({
      toolCallId: 't',
      toolName: 'Edit',
    })
  })
})
