import { expect, test } from 'bun:test'
import { replaceParticipantUsage, summarizeParticipantUsage } from './participant-usage'

const first = {
  role: 'assistant',
  from: 'agent:former',
  usage: { inputTokens: 20, outputTokens: 5, totalCost: 0.1, costSource: 'subscription' as const },
}
const second = { role: 'assistant', from: 'agent:current', usage: { totalTokens: 10 } }

test('usage stays attributed to authors regardless of membership and ignores user rows', () => {
  expect(summarizeParticipantUsage([first, second, { ...first, role: 'user' }])).toMatchObject({
    former: { totalTokens: 25, totalCost: 0.1, costSource: 'subscription' },
    current: { totalTokens: 10 },
  })
})

test('partial-history corrections preserve unloaded usage and duplicate snapshots count once', () => {
  const summary = summarizeParticipantUsage([first, first, second])
  const corrected = { ...first, usage: { ...first.usage, inputTokens: 30 } }
  const next = replaceParticipantUsage(summary, first, corrected)
  expect(next?.former.totalTokens).toBe(60)
  expect(replaceParticipantUsage(next, corrected, corrected)).toBe(next)
  expect(replaceParticipantUsage(next, corrected, undefined)?.former.totalTokens).toBe(25)
  const reattributed = replaceParticipantUsage(next, corrected, {
    ...corrected,
    from: 'agent:current',
  })
  expect(reattributed?.former.totalTokens).toBe(25)
  expect(reattributed?.current.totalTokens).toBe(45)
})

test('unknown authors are not attributed to an arbitrary current participant', () => {
  expect(summarizeParticipantUsage([{ role: 'assistant', usage: { totalTokens: 5 } }])).toEqual({})
})
