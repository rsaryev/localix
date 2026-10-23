/**
 * THE HOST'S VIEW ACROSS TURNS: the properties the checkpoint design exists for, checked on the
 * real strategy rather than on its parts.
 *
 *   append-only — between checkpoints turn N's request is a byte prefix of turn N+1's, which is
 *                 what keeps the provider's prefix cache and the model's preserved thinking;
 *   deltas      — a turn's runtime context carries only what changed since the agent's last one;
 *   checkpoint  — a due turn rewrites the view once, and the record it returns reproduces that
 *                 view on the next turn, which then appends to it again.
 *
 * Each turn is driven the way the run drives it: the previous turn's outputs (its stored runtime
 * context, its checkpoint) come back as the next turn's `ModelView`.
 */
import { describe, expect, test } from 'bun:test'
import type { ContextCheckpoint } from '@localixai/agent'

import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import type { PersistedMessage } from '../../contracts'
import { turnContextState, type StoredTurnContext } from '../model-view/turn-context'
import type { ModelView } from '../model-view/view'
import {
  bashMessage,
  freshLane,
  materializeChat,
  persistedRow,
  readMessage,
} from './testing/test-fixtures'

const VIEWER = 'agent:default'
const user = (id: string, content: string) =>
  persistedRow(id, { role: 'user', from: 'user', content })
const answer = (id: string, content: string) =>
  persistedRow(id, { role: 'assistant', from: VIEWER, content })

/**
 * The bytes the provider matches a cached prefix on. The wall clock is stamped per request and
 * never sent; `cacheAnchor` is a breakpoint MARKER that moves to the newest prompt each turn —
 * a request annotation, not content, so it is not part of the prefix.
 */
const bytesOf = (wire: readonly unknown[]) =>
  wire.map((message) =>
    JSON.stringify(message, (key, v) =>
      key === 'timestamp' || key === 'cacheAnchor' ? undefined : v,
    ),
  )

function expectPrefix(earlier: readonly unknown[], later: readonly unknown[]) {
  const a = bytesOf(earlier)
  const b = bytesOf(later)
  expect(b.length).toBeGreaterThan(a.length)
  expect(b.slice(0, a.length)).toEqual(a)
}

/** The view the next turn starts from, rebuilt from what earlier turns persisted. */
function viewAfter(
  contexts: ReadonlyMap<string, StoredTurnContext>,
  checkpoint?: { hostId: string; record: ContextCheckpoint },
  over: Partial<ModelView> = {},
): ModelView {
  return {
    viewer: VIEWER,
    turnContexts: contexts,
    ...(checkpoint ? { checkpoint } : {}),
    ...(contexts.size > 0
      ? { previous: { state: turnContextState([...contexts.values()]), bindingIds: new Set() } }
      : {}),
    epochId: checkpoint?.hostId ?? '',
    ...over,
  }
}

const env: RuntimeSection = { key: 'runtime', scope: 'state', text: '# Runtime\nCwd: /repo' }
const jobs = (text: string): RuntimeSection => ({
  key: 'background-jobs',
  scope: 'state',
  text: `# Background jobs\n${text}`,
})

describe('between checkpoints the history is append-only', () => {
  test("turn N's request is an exact byte prefix of turn N+1's", async () => {
    const first = [user('u1', 'Build the importer.')]
    const turn1 = await materializeChat(first, {
      assistantMessageId: 'a1',
      runtimeSections: [env, jobs('bg-1 running')],
    })
    expect(turn1.turnContext).toBeDefined()

    const contexts = new Map([['a1', turn1.turnContext!]])
    const second = [...first, answer('a1', 'Started.'), user('u2', 'Status?')]
    const turn2 = await materializeChat(second, {
      assistantMessageId: 'a2',
      runtimeSections: [env, jobs('bg-1 finished')],
      view: viewAfter(contexts),
    })
    expectPrefix(turn1.wire, turn2.wire)

    const third = [...second, answer('a2', 'It finished.'), user('u3', 'Next?')]
    const turn3 = await materializeChat(third, {
      assistantMessageId: 'a3',
      runtimeSections: [env],
      view: viewAfter(new Map([...contexts, ['a2', turn2.turnContext!]])),
    })
    expectPrefix(turn2.wire, turn3.wire)
  })
})

describe("a turn's runtime context carries only what changed", () => {
  test('the first turn renders everything; later ones send the delta, removals named', async () => {
    const turn1 = await materializeChat([user('u1', 'hi')], {
      assistantMessageId: 'a1',
      runtimeSections: [env, jobs('bg-1 running')],
    })
    expect(turn1.turnContext?.full).toBe(true)
    expect(turn1.turnContext?.content).toStartWith('<runtime-context>')
    expect(turn1.turnContext?.content).toContain('Cwd: /repo')

    const contexts = new Map([['a1', turn1.turnContext!]])
    const history = [user('u1', 'hi'), answer('a1', 'hello'), user('u2', 'and?')]
    const turn2 = await materializeChat(history, {
      assistantMessageId: 'a2',
      runtimeSections: [env, jobs('bg-1 finished')],
      view: viewAfter(contexts),
    })
    const delta = turn2.turnContext!
    expect(delta.full).toBeUndefined()
    expect(delta.content).toStartWith('<runtime-context update>')
    expect(delta.content).toContain('bg-1 finished')
    expect(delta.content).not.toContain('Cwd: /repo')
    expect(delta.changes).toEqual({ 'background-jobs': '# Background jobs\nbg-1 finished' })

    const turn3 = await materializeChat([...history, answer('a2', 'done'), user('u3', 'ok')], {
      assistantMessageId: 'a3',
      runtimeSections: [env],
      view: viewAfter(new Map([...contexts, ['a2', delta]])),
    })
    expect(turn3.turnContext?.content).toContain('# Background jobs\n(no longer present)')
    expect(turn3.turnContext?.changes).toEqual({ 'background-jobs': null })
  })

  test('an unchanged state sends no runtime context at all', async () => {
    const turn1 = await materializeChat([user('u1', 'hi')], {
      assistantMessageId: 'a1',
      runtimeSections: [env],
    })
    const turn2 = await materializeChat(
      [user('u1', 'hi'), answer('a1', 'hello'), user('u2', 'x')],
      {
        assistantMessageId: 'a2',
        runtimeSections: [env],
        view: viewAfter(new Map([['a1', turn1.turnContext!]])),
      },
    )
    expect(turn2.turnContext).toBeUndefined()
  })
})

describe('a due checkpoint rewrites the view once, then the history appends again', () => {
  /**
   * Reads alone would be MASKED, not evicted — a recoverable observation is the cheapest thing
   * to shrink, and the planner evicts only what masking and folding cannot fit. Long answers
   * and bash output (neither recoverable from disk) force the eviction this case is about.
   */
  const longHistory = (): PersistedMessage[] =>
    Array.from({ length: 30 }, (_, i) => [
      user(`u-${i}`, `step ${i}`),
      i % 2 === 0 ? readMessage(i) : bashMessage(i),
      answer(`r-${i}`, `Finding ${i}: `.padEnd(3_000, 'detail ')),
    ]).flat()

  test('evicts into cards, returns the record, and the next turn reproduces the view', async () => {
    const history = [...longHistory(), user('u-now', 'Where are we?')]
    const taken = await materializeChat(history, {
      contextWindow: 32_000,
      assistantMessageId: 'a-cp',
      runtimeSections: [env],
      state: freshLane(),
      view: viewAfter(new Map(), undefined, { due: 'threshold', epochId: 'a-cp' }),
    })
    const record = taken.checkpoint
    expect(record).toBeDefined()
    expect(record!.evictedThroughId).toBeDefined()
    expect(record!.tokens.after).toBeLessThanOrEqual(record!.tokens.target)
    expect(JSON.stringify(taken.wire)).toContain('<context-checkpoint>')
    // The turn that took the checkpoint starts a new view, so its runtime context is complete.
    expect(taken.turnContext?.full).toBe(true)

    const next = await materializeChat(
      [...history, answer('a-cp', 'At step 29.'), user('u-next', 'Continue.')],
      {
        contextWindow: 32_000,
        assistantMessageId: 'a-next',
        runtimeSections: [env],
        state: freshLane(),
        view: viewAfter(new Map([['a-cp', taken.turnContext!]]), {
          hostId: 'a-cp',
          record: record!,
        }),
      },
    )
    expect(next.checkpoint).toBeUndefined()
    expectPrefix(taken.wire, next.wire)
  })
})
