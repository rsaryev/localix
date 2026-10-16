import { describe, expect, test } from 'bun:test'
import type { AgentRecord } from '@/shared/api/contracts'
import { draftFromRecord, draftToInput, emptyAgentDraft, sameDraft } from './agentDraft'

const record = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: 'agent-1',
  handle: 'reviewer',
  leadershipPriority: 0,
  description: 'Reviews',
  instructions: 'You review.',
  ...over,
})

describe('native agent draft', () => {
  test('context can be authored and cleared without silently restoring the original context', () => {
    const original = record({ context: { preloadSkills: ['old'], memory: { scope: 'global' } } })
    expect(
      draftToInput({
        ...draftFromRecord(original),
        preloadSkills: 'review\nstyle,review',
        memoryScope: 'session',
      }),
    ).toMatchObject({
      ok: true,
      input: { context: { preloadSkills: ['review', 'style'], memory: { scope: 'session' } } },
    })
    const cleared = draftToInput({
      ...draftFromRecord(original),
      preloadSkills: '',
      memoryScope: 'inherit',
    })
    expect(cleared.ok && cleared.input.context).toBeUndefined()
  })

  test('context survives editing but identity and source data are not submitted', () => {
    const original = record({
      context: { preloadSkills: ['review'], memory: { scope: 'project' } },
    })
    const out = draftToInput({ ...draftFromRecord(original), description: 'Edited' }, original)
    expect(out).toMatchObject({
      ok: true,
      input: { description: 'Edited', context: original.context },
    })
    expect(out.ok && 'id' in out.input).toBe(false)
  })

  test('model and provider are one preference; clearing the model clears the provider', () => {
    const original = record({
      modelPreference: { provider: 'provider-a', model: 'model-a', effort: 'high' },
    })
    const kept = draftToInput(draftFromRecord(original), original)
    expect(kept).toMatchObject({ ok: true, input: { modelPreference: original.modelPreference } })
    const cleared = draftToInput({ ...draftFromRecord(original), model: '' }, original)
    expect(cleared).toMatchObject({ ok: true, input: { modelPreference: { effort: 'high' } } })
    expect(cleared.ok && cleared.input.modelPreference?.provider).toBeUndefined()
  })

  test('cleared optional fields are removed', () => {
    const original = record({ label: 'Reviewer', limits: { maxTurns: 4 } })
    const out = draftToInput({ ...draftFromRecord(original), label: '', maxTurns: '' }, original)
    expect(out.ok && out.input.label).toBeUndefined()
    expect(out.ok && out.input.limits).toBeUndefined()
  })

  test('instructions are required for every definition', () => {
    for (const name of ['custom', 'localix']) {
      expect(draftToInput({ ...emptyAgentDraft(), name, prompt: '   ' }).ok).toBe(false)
    }
  })

  test('whitespace is not a change', () => {
    const draft = draftFromRecord(record())
    expect(sameDraft(draft, { ...draft, description: 'Reviews  ' })).toBe(true)
    expect(sameDraft(draft, { ...draft, description: 'Edited' })).toBe(false)
  })

  test('validates handles and positive turn limits', () => {
    const base = { ...emptyAgentDraft(), name: 'reviewer', prompt: 'Review.' }
    expect(draftToInput({ ...base, name: '../escape' }).ok).toBe(false)
    expect(draftToInput({ ...base, maxTurns: '0' }).ok).toBe(false)
    expect(draftToInput({ ...base, maxTurns: '12' })).toMatchObject({
      ok: true,
      input: { handle: 'reviewer', instructions: 'Review.', limits: { maxTurns: 12 } },
    })
  })

  test('validates and persists the bounded hierarchy priority', () => {
    const base = { ...emptyAgentDraft(), name: 'reviewer', prompt: 'Review.' }
    expect(draftToInput({ ...base, leadershipPriority: ' ' })).toMatchObject({
      ok: false,
      errors: { leadershipPriority: expect.any(String) },
    })
    expect(draftToInput({ ...base, leadershipPriority: '2' })).toMatchObject({
      ok: true,
      input: { leadershipPriority: 2 },
    })
    expect(draftToInput({ ...base, leadershipPriority: '3' }).ok).toBe(false)
  })

  /**
   * The old shape returned one sentence for the whole form, pinned above the footer:
   * "Name and system prompt are required." — naming fields the reader then had to go find,
   * in a drawer tall enough that they were usually scrolled out of view. And it stopped at
   * the first problem, so fixing the name revealed the next sentence rather than the end.
   */
  const refusal = (draft: Parameters<typeof draftToInput>[0]) => {
    const result = draftToInput(draft)
    if (result.ok) throw new Error('Expected this draft to be refused')
    return result.errors
  }

  test('reports every problem at once, each against its own field', () => {
    const errors = refusal({ ...emptyAgentDraft(), maxTurns: 'x' })
    expect(Object.keys(errors)).toEqual(['name', 'prompt', 'maxTurns'])
    expect(errors.name).toBe('Required.')
  })

  test('the order is the order of the fields, which is what focus-on-submit follows', () => {
    // `focusFirstInvalid` walks the object's own keys, so a validator that reported the
    // prompt before the name would send the reader to the second problem first.
    expect(Object.keys(refusal({ ...emptyAgentDraft(), name: '../escape' }))).toEqual([
      'name',
      'prompt',
    ])
  })

  test('a bad handle complains about the handle, not about the form', () => {
    const errors = refusal({ ...emptyAgentDraft(), name: '../escape', prompt: 'Review.' })
    expect(Object.keys(errors)).toEqual(['name'])
    expect(errors.name).toContain('code-reviewer')
  })
})
