/**
 * hooks.md: "A blocked prompt never reaches Claude". The run that blocked it makes no model call,
 * and the next turn must not carry it either: the row the person still sees is kept out of the
 * model's history. A Retry of the blocked turn submits the prompt to the hooks again instead of
 * answering the previous reply.
 */
import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import { agentAuthor, USER_AUTHOR, type StoredMessagePayload } from '../../../../db'
import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import { intakeTurn, markPromptBlocked } from './intake'

function message(id: string, content: string, role: 'user' | 'assistant' = 'user') {
  const from = role === 'user' ? USER_AUTHOR : agentAuthor('agent-1')
  return {
    id,
    sessionId: 'session-1',
    userId: 'user-1',
    payload: { id, role, from, content },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  } as PersistedMessage
}

function harness(rows: PersistedMessage[]) {
  const published: unknown[] = []
  const deps = {
    repo: {
      updateMessage: async (
        _userId: string,
        _sessionId: string,
        id: string,
        patch: Partial<StoredMessagePayload>,
      ) => {
        const row = rows.find((entry) => entry.id === id)!
        row.payload = { ...row.payload, ...patch }
        return { payload: row.payload, payloadJson: JSON.stringify(row.payload) }
      },
    },
    streamRegistry: { publish: (...args: unknown[]) => published.push(args) },
  }
  const submitted: string[] = []
  const hooks = (blocked: boolean): CcHooksRuntime => ({
    ...INERT_CC_HOOKS,
    active: true,
    runUserPromptSubmit: async (prompt: string) => {
      submitted.push(prompt)
      return blocked ? { blocked: true, reason: 'no secrets' } : { blocked: false }
    },
  })
  const intake = (ccHooks: CcHooksRuntime, history = rows) =>
    intakeTurn({
      deps: deps as never,
      userId: 'user-1',
      session: { id: 'session-1' } as never,
      assistantMessageId: 'assistant-1',
      assistantCreatedAt: '2026-07-28T00:00:00.000Z',
      historyMessages: history,
      loadedPlugins: {} as never,
      loadedMiniApps: { hooks: [] } as never,
      ccHooks,
      ccSessionStartContext: undefined,
      runtimeSections: [],
      defaultCwd: '/repo',
      now: () => '2026-07-28T00:00:00.000Z',
    })
  /** The run stage: mark a blocked prompt, lift the mark from an accepted one. */
  const runIntake = async (ccHooks: CcHooksRuntime, history = rows) => {
    const result = await intake(ccHooks, history)
    if (!result.ok && result.promptMessage)
      await markPromptBlocked(deps as never, 'user-1', result.promptMessage, true, 'later')
    if (result.ok && result.frame.promptMessage)
      await markPromptBlocked(deps as never, 'user-1', result.frame.promptMessage, false, 'later')
    return result
  }
  return { deps, published, submitted, hooks, runIntake }
}

describe('a prompt blocked by UserPromptSubmit', () => {
  test('stays in the transcript as a prompt but out of every later turn', async () => {
    const rows = [message('secret', 'SECRET-PROMPT do it')]
    const { published, hooks, runIntake } = harness(rows)

    const blocked = await runIntake(hooks(true))
    expect(blocked.ok).toBe(false)
    expect(rows[0]?.payload.promptBlocked).toBe(true)
    expect(rows[0]?.payload.uiOnly).toBeUndefined()

    rows.push(message('next', 'what is 2+2?'))
    const next = await runIntake(INERT_CC_HOOKS)
    if (!next.ok) throw new Error('unexpected block')
    expect(next.frame.messages.map((m) => m.id)).toEqual(['next'])
    expect(rows[0]?.payload.content).toBe('SECRET-PROMPT do it')
    expect(published).toHaveLength(1)
  })

  test('a Retry submits the blocked prompt to the hooks again, never the previous reply', async () => {
    const rows = [
      message('hello', 'Hello'),
      message('answer', 'FIRST-ANSWER', 'assistant'),
      message('secret', 'SECRET-PROMPT do it'),
    ]
    const { submitted, hooks, runIntake } = harness(rows)
    expect((await runIntake(hooks(true))).ok).toBe(false)

    // Retry: regenerate re-enters with the history up to the blocked prompt, and it blocks again.
    expect((await runIntake(hooks(true))).ok).toBe(false)
    expect(submitted).toEqual(['SECRET-PROMPT do it', 'SECRET-PROMPT do it'])

    // The hook now accepts it: the prompt is what the model answers, and later turns keep it.
    const retried = await runIntake(hooks(false))
    if (!retried.ok) throw new Error('unexpected block')
    expect(retried.frame.messages.map((m) => m.id)).toEqual(['hello', 'answer', 'secret'])
    expect(retried.frame.promptMessage?.id).toBe('secret')
    expect(rows[2]?.payload.promptBlocked).toBeUndefined()

    rows.push(message('reply', 'ok', 'assistant'), message('next', 'more'))
    const next = await runIntake(INERT_CC_HOOKS)
    if (!next.ok) throw new Error('unexpected block')
    expect(next.frame.messages.map((m) => m.id)).toContain('secret')
  })
})

describe("a blocked prompt's message", () => {
  const blockWith = (extra: { suppressOriginalPrompt?: true }, reason = 'no secrets') => {
    const rows = [message('m1', 'my password is hunter2')]
    const h = harness(rows)
    const hooks = {
      ...INERT_CC_HOOKS,
      active: true,
      runUserPromptSubmit: async () => ({ blocked: true, reason, ...extra }),
    } as CcHooksRuntime
    return h.runIntake(hooks)
  }

  // hooks.md: "By default the block message ... ends with `Original prompt:` followed by the
  // submitted text"; `suppressOriginalPrompt` leaves the text out.
  test('ends with the submitted text by default', async () => {
    const result = await blockWith({})
    expect(result).toMatchObject({
      ok: false,
      blockedReason: 'no secrets\n\nOriginal prompt: my password is hunter2',
    })
  })

  test('leaves the text out when the hook suppresses it', async () => {
    const result = await blockWith({ suppressOriginalPrompt: true })
    expect(result).toMatchObject({ ok: false, blockedReason: 'no secrets' })
  })
})
