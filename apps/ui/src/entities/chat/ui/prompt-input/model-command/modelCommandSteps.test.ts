import { describe, expect, test } from 'bun:test'
import { modelStepOptions, skipModelStep } from './modelCommandSteps'
import { sortCatalogModelsNewestFirst } from '@localixai/agent/catalog'
import { agentRow, context, MODELS } from './testing/modelCommandFixture'

const values = (rows: { value: string }[]) => rows.map((row) => row.value)
const committedMap = (record: Record<string, string>) => new Map(Object.entries(record))

describe('/model steps — which apply', () => {
  test('the conversation’s agent is never asked for', () => {
    expect(skipModelStep(context(agentRow('solo', 'openai/gpt')), 'agent', new Map())).toBe(true)
  })

  test('Reasoning is skipped for a model that does not reason', () => {
    const ctx = context(agentRow('solo', 'openai/gpt'))
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

  test('a model whose Auto is its whole window has no Context limit step', () => {
    const ctx = context(agentRow('solo', 'openai/gpt'))
    const opus = { provider: 'conn-anthropic', model: 'anthropic/opus' }
    const gpt = { provider: 'conn-openai', model: 'openai/gpt' }
    expect(skipModelStep(ctx, 'context', committedMap(opus))).toBe(true)
    expect(skipModelStep(ctx, 'context', committedMap(gpt))).toBe(false)
  })
})

describe('/model steps — rows', () => {
  const solo = context(agentRow('solo', 'anthropic/opus', 'max'))

  test('the provider step lists the connections and marks the agent’s', () => {
    const rows = modelStepOptions(solo, 'provider', '', {})
    expect(values(rows)).toEqual(['conn-anthropic', 'conn-openai'])
    expect(rows[0]?.description).toContain('current')
  })

  test('the model step lists that connection’s models and filters by the typed text', () => {
    expect(values(modelStepOptions(solo, 'model', '', { provider: 'conn-openai' }))).toEqual([
      'openai/gpt',
      'openai/plain',
    ])
    expect(values(modelStepOptions(solo, 'model', 'pla', { provider: 'conn-openai' }))).toEqual([
      'openai/plain',
    ])
  })

  test('the model step lists models newest-first, undated last, as the catalog serves them', () => {
    const served = sortCatalogModelsNewestFirst([
      { ...MODELS[2]!, id: 'openai/undated', name: 'Undated' },
      { ...MODELS[1]!, id: 'openai/older', releaseDate: '2025-05-01' },
      { ...MODELS[1]!, id: 'openai/newer', releaseDate: '2026-09-29' },
    ])
    const ctx = context(agentRow('solo', 'openai/newer'), { models: served })
    expect(values(modelStepOptions(ctx, 'model', '', { provider: 'conn-openai' }))).toEqual([
      'openai/newer',
      'openai/older',
      'openai/undated',
    ])
  })

  test('Reasoning offers only the levels the model really has — Off only where it is real', () => {
    const opus = { provider: 'conn-anthropic', model: 'anthropic/opus' }
    expect(values(modelStepOptions(solo, 'reasoning', '', opus))).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
    const gpt = { provider: 'conn-openai', model: 'openai/gpt' }
    expect(values(modelStepOptions(solo, 'reasoning', '', gpt))[0]).toBe('off')
  })

  test('the row the agent would start at is marked current', () => {
    const opus = { provider: 'conn-anthropic', model: 'anthropic/opus' }
    const rows = modelStepOptions(solo, 'reasoning', '', opus)
    expect(rows.find((row) => row.value === 'max')?.description).toContain('current')
  })

  test('Turns and Context limit offer keep, default and the controls’ own steps', () => {
    const picked = { provider: 'conn-openai', model: 'openai/gpt' }
    const turns = values(modelStepOptions(solo, 'turns', '', picked))
    expect(turns.slice(0, 2)).toEqual(['keep', 'default'])
    expect(turns).toContain('20')
    // The 1M model's own ladder, like its reasoning levels: Auto, the steps it holds, Full.
    expect(values(modelStepOptions(solo, 'context', '', picked))).toEqual([
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
    const capped = context(agentRow('lead', 'openai/gpt', 'high', { maxTurnsLimit: 20 }))
    const picked = { provider: 'conn-openai', model: 'openai/gpt' }
    expect(values(modelStepOptions(capped, 'turns', '', picked))).toEqual([
      'keep',
      'default',
      '1',
      '5',
      '20',
    ])
  })
})
