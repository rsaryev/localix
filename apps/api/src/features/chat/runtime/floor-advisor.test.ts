import { describe, expect, test } from 'bun:test'
import type { DecisionAsk, DecisionOptions, DecisionOutcome } from '@localixai/mini-app-sdk/backend'
import { createFloorAdvisor, type FloorDecisionRecord, type FloorStrategy } from './floor-advisor'
import type { FloorQuestion } from './floor-advice'
import { decisionFloorStrategy } from './floor-decision'
import { similarityFloorStrategy } from './floor-similarity'
import { cosine } from '../../embeddings/semantic-vectors'

const question: FloorQuestion = {
  members: [
    { agentId: 'builtin:localix', handle: 'localix' },
    { agentId: 'builtin:lawyer', handle: 'lawyer' },
  ],
  history: [],
  text: 'Can we reuse photos from other shops for the product cards?',
  leaderAgentId: 'builtin:localix',
}
const scope = { userId: 'u1', sessionId: 's1', projectId: null }
const JEV = 'openrouter/~typesafe/jev-latest'

/** The decision strategy over a scripted decision service (or none available). */
function decision(options: {
  available?: boolean
  outcome?: (ask: DecisionAsk, options: DecisionOptions) => Promise<DecisionOutcome>
}) {
  const asked: { ask: DecisionAsk; options: DecisionOptions }[] = []
  const outcome =
    options.outcome ??
    (async (): Promise<DecisionOutcome> => ({
      status: 'answered',
      model: JEV,
      ms: 5,
      answers: {
        next: { type: 'choice', choice: 'lawyer', probabilities: { lawyer: 0.93, localix: 0.07 } },
      },
    }))
  const strategy = decisionFloorStrategy({
    available: async () => (options.available === false ? null : { model: JEV }),
    decide: (_userId, ask, callOptions) => {
      asked.push({ ask, options: callOptions })
      return outcome(ask, callOptions)
    },
  })
  return { strategy, asked }
}

/** A strategy that always answers `pick`, or is unavailable. */
const fixed = (pick: string | null, available = true): FloorStrategy => ({
  prepare: async () =>
    available
      ? {
          strategy: 'similarity',
          model: 'fixed',
          advise: async () => ({ pick, reason: pick ? 'similar' : 'unsure', next: {} }),
        }
      : null,
})

function advisor(strategies: FloorStrategy[], deadlineMs?: number) {
  const records: FloorDecisionRecord[] = []
  const advise = createFloorAdvisor({
    strategies,
    listRegistryAgents: async () => [
      {
        agentId: 'builtin:lawyer',
        name: 'lawyer',
        description: 'Contracts and consent.',
        enabled: true,
        canJoinConversation: true,
      },
    ],
    ...(deadlineMs ? { deadlineMs } : {}),
    log: (record) => records.push(record),
  })(scope)
  return { advise, records }
}

describe('the chain of group-routing strategies', () => {
  test('with a decision model available, it answers, asked as routing for this session', async () => {
    const jev = decision({})
    const { advise, records } = advisor([jev.strategy, fixed('localix')])
    expect(await advise(question)).toBe('lawyer')
    // Options are described from the agent directory, like the prompt describes them.
    expect((jev.asked[0]!.ask.questions.next!.criteria as Record<string, string>).lawyer).toBe(
      'Contracts and consent.',
    )
    expect(jev.asked[0]!.options).toMatchObject({
      purpose: 'routing',
      usageKind: 'routing',
      sessionId: 's1',
    })
    expect(records).toEqual([
      expect.objectContaining({
        strategy: 'decision',
        model: JEV,
        pick: 'lawyer',
        reason: 'confident',
      }),
    ])
  })

  test('without a decision model, the next strategy answers', async () => {
    const jev = decision({ available: false })
    const { advise, records } = advisor([jev.strategy, fixed('lawyer')])
    expect(await advise(question)).toBe('lawyer')
    expect(jev.asked).toEqual([])
    expect(records[0]).toMatchObject({ strategy: 'similarity', model: 'fixed' })
  })

  test('with nothing available, the grammar decides and the log says why', async () => {
    const { advise, records } = advisor([
      decision({ available: false }).strategy,
      fixed('x', false),
    ])
    expect(await advise(question)).toBeNull()
    expect(records).toEqual([expect.objectContaining({ strategy: null, reason: 'none' })])
  })

  test('a decision without answers leaves the turn to the grammar, not to the next strategy', async () => {
    const jev = decision({ outcome: async () => ({ status: 'failed', model: JEV, ms: 3 }) })
    const { advise, records } = advisor([jev.strategy, fixed('lawyer')])
    expect(await advise(question)).toBeNull()
    expect(records).toEqual([expect.objectContaining({ strategy: 'decision', reason: 'error' })])
  })

  test('an unconfident answer is no advice', async () => {
    const jev = decision({
      outcome: async () => ({
        status: 'answered',
        model: JEV,
        ms: 5,
        answers: { next: { type: 'choice', choice: 'lawyer', probabilities: { lawyer: 0.55 } } },
      }),
    })
    expect(await advisor([jev.strategy]).advise(question)).toBeNull()
  })

  test('a slow answer is cut at the deadline, and the decision is told to stop', async () => {
    let stopped = false
    const jev = decision({
      outcome: (_ask, options) =>
        new Promise((resolve) =>
          options.signal?.addEventListener('abort', () => {
            stopped = true
            resolve({ status: 'cancelled', ms: 50 })
          }),
        ),
    })
    const { advise, records } = advisor([jev.strategy], 50)
    const started = Date.now()
    expect(await advise(question)).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(stopped).toBe(true)
    expect(records).toEqual([expect.objectContaining({ reason: 'deadline' })])
  })

  test('the log names who answered and why, without message text', async () => {
    const { advise, records } = advisor([decision({}).strategy])
    await advise(question)
    expect(JSON.stringify(records)).not.toContain('photos')
  })
})

describe('the similarity strategy', () => {
  // A toy vectors port: each text's vector says which of a few topics it mentions.
  const TOPICS = ['photos', 'contract', 'hello', 'tiles']
  const embed = (text: string) =>
    Float32Array.from(TOPICS.map((t) => (text.toLowerCase().includes(t) ? 1 : 0.01)))
  const vectors = (ready: boolean) => ({
    ready: () => (ready ? { model: 'gemma', dimensions: TOPICS.length } : null),
    rank: async (query: string, candidates: readonly { key: string; text: string }[]) => ({
      model: 'gemma',
      ranked: candidates
        .map((candidate) => ({
          key: candidate.key,
          cosine: cosine(embed(query), embed(candidate.text)),
        }))
        .sort((a, b) => b.cosine - a.cosine),
    }),
  })
  const members = [
    { agentId: 'builtin:localix', handle: 'localix', description: 'Says hello and coordinates.' },
    { agentId: 'builtin:lawyer', handle: 'lawyer', description: 'Contracts, photos and licences.' },
  ]
  const strategy = similarityFloorStrategy(vectors(true))

  test('unavailable while the embedding model cannot run', async () => {
    const none = similarityFloorStrategy(vectors(false))
    expect(await none.prepare(scope)).toBeNull()
  })

  test('the person’s untagged message goes to the participant it is clearly nearest to', async () => {
    const runner = (await strategy.prepare(scope))!
    const reading = await runner.advise(
      { ...question, members, text: 'May we reuse these photos?' },
      new AbortController().signal,
    )
    expect(reading).toMatchObject({ pick: 'lawyer', reason: 'similar' })
  })

  test('a reply is never advised on: similarity cannot tell a report from a handoff', async () => {
    const runner = (await strategy.prepare(scope))!
    const reading = await runner.advise(
      { ...question, members, authorAgentId: 'builtin:lawyer', text: 'The photos are fine.' },
      new AbortController().signal,
    )
    expect(reading.pick).toBeNull()
  })
})
