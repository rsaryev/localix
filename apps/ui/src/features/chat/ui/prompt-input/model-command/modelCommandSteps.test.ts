import { describe, expect, test } from 'bun:test'
import { modelStepOptions, skipModelStep } from './modelCommandSteps'
import { sortCatalogModelsNewestFirst } from '@localixai/agent/catalog'
import { context, MODELS, member } from './modelCommandFixture'

const values = (rows: { value: string }[]) => rows.map((row) => row.value)
const committedMap = (record: Record<string, string>) => new Map(Object.entries(record))

describe('/model steps — which apply', () => {
  test('every chat with an agent has the agent step: All agents is always a choice', () => {
    expect(skipModelStep(context([member('solo', 'openai/gpt')]), 'agent', new Map())).toBe(false)
    expect(skipModelStep(context([]), 'agent', new Map())).toBe(true)
    const group = context([member('lead', 'openai/gpt'), member('qa', 'anthropic/opus')])
    expect(skipModelStep(group, 'agent', new Map())).toBe(false)
  })

  test('Reasoning is skipped for a model that does not reason', () => {
    const ctx = context([member('solo', 'openai/gpt')])
    expect(
      skipModelStep(
        ctx,
        'reasoning',
        committedMap({ provider: 'conn-openai', model: 'openai/plain' }),
      ),
    ).toBe(true)
    expect(
      skipModelStep(
        ctx,
        'reasoning',
        committedMap({ provider: 'conn-openai', model: 'openai/gpt' }),
      ),
    ).toBe(false)
  })

  test('All agents has no per-agent Turns or Context limit, as in the picker', () => {
    const group = context([member('lead', 'openai/gpt'), member('qa', 'anthropic/opus')])
    expect(skipModelStep(group, 'turns', committedMap({ agent: 'all' }))).toBe(true)
    expect(skipModelStep(group, 'context', committedMap({ agent: 'all' }))).toBe(true)
    expect(skipModelStep(group, 'context', committedMap({ agent: '@qa' }))).toBe(false)
  })

  test('a model whose Auto is its whole window has no Context limit step', () => {
    const group = context([member('lead', 'openai/gpt'), member('qa', 'anthropic/opus')])
    const opus = { agent: '@qa', provider: 'conn-anthropic', model: 'anthropic/opus' }
    const gpt = { agent: '@qa', provider: 'conn-openai', model: 'openai/gpt' }
    expect(skipModelStep(group, 'context', committedMap(opus))).toBe(true)
    expect(skipModelStep(group, 'context', committedMap(gpt))).toBe(false)
  })
})

describe('/model steps — rows', () => {
  const group = context([
    member('lead', 'openai/gpt', 'high', { label: 'Lead' }),
    member('qa', 'anthropic/opus', 'max'),
  ])

  test('the agent step offers All agents first, then every member', () => {
    const rows = modelStepOptions(group, 'agent', '', {})
    expect(values(rows)).toEqual(['all', '@lead', '@qa'])
    expect(rows[0]?.description).toContain('Mixed')
    expect(rows[1]).toMatchObject({ label: 'Lead', description: 'GPT · High' })
  })

  test('the provider step lists the connections and marks the target’s', () => {
    const rows = modelStepOptions(group, 'provider', '', { agent: '@qa' })
    expect(values(rows)).toEqual(['conn-anthropic', 'conn-openai'])
    expect(rows[0]?.description).toContain('current')
  })

  test('the model step lists that connection’s models and filters by the typed text', () => {
    expect(values(modelStepOptions(group, 'model', '', { provider: 'conn-openai' }))).toEqual([
      'openai/gpt',
      'openai/plain',
    ])
    expect(values(modelStepOptions(group, 'model', 'pla', { provider: 'conn-openai' }))).toEqual([
      'openai/plain',
    ])
  })

  test('the model step lists models newest-first, undated last, as the catalog serves them', () => {
    const served = sortCatalogModelsNewestFirst([
      { ...MODELS[2]!, id: 'openai/undated', name: 'Undated' },
      { ...MODELS[1]!, id: 'openai/older', releaseDate: '2025-05-01' },
      { ...MODELS[1]!, id: 'openai/newer', releaseDate: '2026-09-29' },
    ])
    const ctx = context([member('lead', 'openai/newer')], { models: served })
    expect(values(modelStepOptions(ctx, 'model', '', { provider: 'conn-openai' }))).toEqual([
      'openai/newer',
      'openai/older',
      'openai/undated',
    ])
  })

  test('Reasoning offers only the levels the model really has — Off only where it is real', () => {
    const opus = { agent: '@qa', provider: 'conn-anthropic', model: 'anthropic/opus' }
    expect(values(modelStepOptions(group, 'reasoning', '', opus))).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
    const gpt = { agent: '@lead', provider: 'conn-openai', model: 'openai/gpt' }
    expect(values(modelStepOptions(group, 'reasoning', '', gpt))[0]).toBe('off')
  })

  test('the row the target would start at is marked current', () => {
    const opus = { agent: '@qa', provider: 'conn-anthropic', model: 'anthropic/opus' }
    const rows = modelStepOptions(group, 'reasoning', '', opus)
    expect(rows.find((row) => row.value === 'max')?.description).toContain('current')
  })

  test('Turns and Context limit offer keep, default and the controls’ own steps', () => {
    const picked = { agent: '@lead', provider: 'conn-openai', model: 'openai/gpt' }
    const turns = values(modelStepOptions(group, 'turns', '', picked))
    expect(turns.slice(0, 2)).toEqual(['keep', 'default'])
    expect(turns).toContain('20')
    // The 1M model's own ladder, like its reasoning levels: Auto, the steps it holds, Full.
    expect(values(modelStepOptions(group, 'context', '', picked))).toEqual([
      'keep',
      'default',
      '128k',
      '200k',
      '400k',
      '600k',
      'full',
    ])
  })

  test('an agent’s turn ceiling bounds the offered steps', () => {
    const capped = context([member('lead', 'openai/gpt', 'high', { maxTurnsLimit: 20 })])
    const picked = { agent: '@lead', provider: 'conn-openai', model: 'openai/gpt' }
    expect(values(modelStepOptions(capped, 'turns', '', picked))).toEqual([
      'keep',
      'default',
      '1',
      '5',
      '20',
    ])
  })
})
