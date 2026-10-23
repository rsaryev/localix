/**
 * Intake is the one impure step; what it hands the strategy is a VALUE. These tests pin the
 * two properties that make the rest of the pipeline re-runnable: the prompt rewrite never
 * resurrects rows the model must not see, and fitting the history never calls a model.
 */
import { describe, expect, test } from 'bun:test'
import { estimateChatMessageTokens } from '@localixai/agent'

import type { PersistedMessage } from '../../contracts'
import { resolveContextBudgetFrame } from '../context-budget'
import { estimateMessageTokens } from '../context-token-estimate'
import { createChatHistoryRun } from './chat-strategy'
import { intakeTurn, rewriteModelPrompt } from './intake'
import { freshLane, freshView, TEST_IDENTITY } from './testing/test-fixtures'
import { USER_PARTICIPANT } from '../../../../db'
import { systemNoticeBinding } from '../../system-notice-bindings'
import { INERT_CC_HOOKS, type CcHooksRuntime, type CcPromptExpansion } from '../../../cc-hooks'

function message(id: string, content: string, uiOnly = false): PersistedMessage {
  return {
    id,
    sessionId: 'session-1',
    userId: 'user-1',
    payload: {
      id,
      role: 'user',
      from: USER_PARTICIPANT,
      content,
      ...(uiOnly ? { uiOnly: true } : {}),
    },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('rewriteModelPrompt', () => {
  test('rewrites on the filtered copy without resurrecting uiOnly history', () => {
    const visible = message('visible', 'real context')
    const uiOnly = message('mode-marker', 'Mode changed', true)
    const prompt = message('prompt', 'original prompt')
    const rawHistory = [visible, uiOnly, prompt]
    const modelHistory = rawHistory.filter((entry) => !entry.payload.uiOnly)

    const rewritten = rewriteModelPrompt(modelHistory, prompt, 'rewritten prompt')

    expect(rewritten.map((entry) => entry.id)).toEqual(['visible', 'prompt'])
    expect(rewritten.at(-1)?.payload.content).toBe('rewritten prompt')
    expect(rawHistory.at(-1)?.payload.content).toBe('original prompt')
  })
})

describe('intake → strategy', () => {
  const intake = (raw: PersistedMessage[], summarize: () => void, sessionId = 'session-1') =>
    intakeTurn({
      deps: {
        languageModelFactory: {
          create: () => {
            summarize()
            throw new Error('no model may be called to fit the history')
          },
        },
      } as never,
      userId: 'user-1',
      session: { id: sessionId } as never,
      assistantMessageId: 'assistant-1',
      assistantCreatedAt: '2026-07-28T00:00:00.000Z',
      historyMessages: raw,
      loadedPlugins: { hooks: [] } as never,
      ccHooks: { active: false } as never,
      ccSessionStartContext: undefined,
      runtimeSections: [],
      defaultCwd: '/repo',
      now: () => '2026-07-28T00:00:00.000Z',
    })

  test('a raw history over the ceiling is fitted by a checkpoint, with zero model calls', async () => {
    const first = message('first', 'Inspect the repository and fix the issue.')
    const toolHeavy = Array.from({ length: 80 }, (_, index) => {
      const entry = message(`tool-${index}`, '')
      entry.payload.role = 'assistant'
      entry.payload.items = [
        {
          type: 'tool_call',
          id: `item-${index}`,
          toolCallId: `read-${index}`,
          name: 'read',
          activeVerb: 'Reading',
          status: 'completed',
          input: { path: `/repo/file-${index}.ts` },
          resultText: `line ${index}\n`.repeat(500),
        },
      ]
      return entry
    })
    const prompt = message('prompt', 'Continue from the evidence above.')
    const raw = [first, ...toolHeavy, prompt]
    const frame = resolveContextBudgetFrame({ contextWindow: 32_000 })
    const estimated = raw.reduce((total, m) => total + estimateMessageTokens(m), 0)
    expect(estimated).toBeGreaterThan(frame.trigger)

    let summarizeCalls = 0
    const taken = await intake(raw, () => summarizeCalls++)
    if (!taken.ok) throw new Error('unexpected block')
    expect(taken.frame.promptMessage?.id).toBe(prompt.id)

    const run = createChatHistoryRun({
      sessionId: 'session-1',
      frame,
      identity: TEST_IDENTITY,
      view: freshView(),
      media: { defaultCwd: '/repo' },
      state: freshLane(),
    })
    const out = await run.materialize(taken.frame, new AbortController().signal)
    const boundedTokens = out.payloads.reduce(
      (sum, payload) => sum + estimateChatMessageTokens(payload),
      0,
    )

    expect(boundedTokens).toBeLessThanOrEqual(frame.historyBudget)
    expect(summarizeCalls).toBe(0)
  })

  test('materializing the same frame twice yields the same wire (the frame is a value)', async () => {
    const raw = [message('u1', 'first'), message('u2', 'second')]
    const taken = await intake(raw, () => {})
    if (!taken.ok) throw new Error('unexpected block')
    const run = createChatHistoryRun({
      sessionId: 'session-1',
      frame: resolveContextBudgetFrame({ contextWindow: 32_000 }),
      identity: TEST_IDENTITY,
      view: freshView(),
      media: {},
      state: freshLane(),
    })
    const strip = (wire: unknown) =>
      JSON.stringify(wire, (key, v) => (key === 'timestamp' ? undefined : v))
    const a = await run.materialize(taken.frame, new AbortController().signal)
    const b = await run.materialize(taken.frame, new AbortController().signal)
    expect(strip(b.wire)).toBe(strip(a.wire))
  })

  test('system notices materialize once on the volatile binding tail, not in cached history', async () => {
    const notice = message('notice', '@pm is now on model-b.', true)
    notice.payload.systemNotice = {
      kind: 'model_change',
      tone: 'neutral',
      text: '@pm is now on model-b.',
    }
    notice.payload.bindings = [
      systemNoticeBinding(notice.payload.systemNotice, notice.id, notice.createdAt),
    ]
    const raw = [message('u1', 'first'), notice, message('u2', 'continue')]
    const taken = await intake(raw, () => {}, 'system-context-session')
    if (!taken.ok) throw new Error('unexpected block')
    const run = createChatHistoryRun({
      sessionId: 'system-context-session',
      frame: resolveContextBudgetFrame({ contextWindow: 32_000 }),
      identity: TEST_IDENTITY,
      view: freshView(),
      media: {},
      state: freshLane(),
    })

    const out = await run.materialize(taken.frame, new AbortController().signal)
    const wire = JSON.stringify(out.wire)

    expect(out.effectiveHistory.some((entry) => entry.id === 'notice')).toBe(false)
    expect(wire.match(/@pm is now on model-b\./g)).toHaveLength(1)
    expect(out.wire.at(-2)?.cacheAnchor).toBe(true)
    expect(out.wire.at(-1)?.cacheAnchor).toBeUndefined()
  })

  test('the latest topic boundary removes earlier prompts and system-event bindings before intake', async () => {
    const old = message('old-notice', 'OLD_SYSTEM_EVENT', true)
    old.payload.systemNotice = {
      kind: 'permission_mode_change',
      tone: 'neutral',
      text: 'OLD_SYSTEM_EVENT',
    }
    old.payload.bindings = [systemNoticeBinding(old.payload.systemNotice, old.id, old.createdAt)]
    const boundary = (id: string) => {
      const entry = message(id, 'OLD_TOPIC_HANDOFF')
      entry.payload.role = 'assistant'
      entry.payload.from = 'agent:lead'
      entry.payload.contextBoundary = true
      return entry
    }
    const current = message('new-notice', 'NEW_SYSTEM_EVENT', true)
    current.payload.systemNotice = {
      kind: 'model_change',
      tone: 'neutral',
      text: 'NEW_SYSTEM_EVENT',
    }
    current.payload.bindings = [
      systemNoticeBinding(current.payload.systemNotice, current.id, current.createdAt),
    ]
    const taken = await intake(
      [
        message('old-user', 'OLD_USER'),
        old,
        boundary('topic-1'),
        message('intermediate-user', 'INTERMEDIATE_TOPIC'),
        boundary('topic-2'),
        current,
        message('current-user', 'NEW_USER'),
      ],
      () => {},
    )
    if (!taken.ok) throw new Error('unexpected block')
    expect(taken.frame.messages.map((m) => m.id)).toEqual(['current-user'])
    expect(taken.frame.promptMessage?.payload.content).toBe('NEW_USER')
    expect(taken.frame.systemBindings).toHaveLength(1)
    expect(JSON.stringify(taken.frame.systemBindings)).toContain('NEW_SYSTEM_EVENT')
    expect(JSON.stringify(taken.frame.systemBindings)).not.toContain('OLD_SYSTEM_EVENT')
  })
})

describe('UserPromptExpansion at intake', () => {
  const typed = (): PersistedMessage => {
    const row = message('prompt', '/deploy staging')
    row.payload.bindings = [
      {
        kind: 'invocation',
        id: 'b1',
        source: 'plugin',
        invocation: {
          kind: 'plugin-command',
          name: 'ops:deploy',
          arguments: 'staging',
          lifetime: 'turn',
        },
        presentation: { label: 'deploy' },
        instruction: 'Deploy to staging.',
      },
    ]
    return row
  }
  const run = (ccHooks: Partial<CcHooksRuntime>) =>
    intakeTurn({
      deps: {} as never,
      userId: 'user-1',
      session: { id: 'session-1' } as never,
      assistantMessageId: 'assistant-1',
      assistantCreatedAt: '2026-07-28T00:00:00.000Z',
      historyMessages: [typed()],
      loadedPlugins: { hooks: [] } as never,
      ccHooks: { ...INERT_CC_HOOKS, active: true, ...ccHooks },
      ccSessionStartContext: undefined,
      runtimeSections: [],
      defaultCwd: '/repo',
      now: () => '2026-07-28T00:00:00.000Z',
    })

  test('a typed command fires after UserPromptSubmit; its context joins the turn', async () => {
    const seen: CcPromptExpansion[] = []
    const result = await run({
      runUserPromptExpansion: async (expansion) => {
        seen.push(expansion)
        return { blocked: false, additionalContext: 'deploy checklist' }
      },
    })
    expect(seen).toEqual([
      {
        commandName: 'ops:deploy',
        commandArgs: 'staging',
        commandSource: 'plugin',
        prompt: '/deploy staging',
      },
    ])
    expect(
      result.ok && result.frame.runtimeSections.find((s) => s.key === 'hook-context')?.text,
    ).toContain('deploy checklist')
  })

  test('a block fails the turn before any model call', async () => {
    const result = await run({
      runUserPromptExpansion: async () => ({ blocked: true, reason: 'needs approval file' }),
    })
    expect(result).toMatchObject({ ok: false, blockedReason: 'needs approval file' })
  })
})
