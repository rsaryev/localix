import { describe, expect, test } from 'bun:test'
import type { CatalogModel } from '@/shared/hooks/useModelsCatalog'
import { buildModelFieldOptions } from './ModelFieldSelect'

const model = (over: Partial<CatalogModel>): CatalogModel => ({
  id: 'gpt-5.6',
  name: 'GPT-5.6',
  providerId: 'openai',
  providerName: 'OpenAI',
  supportsTools: true,
  supportsReasoning: true,
  supportsAttachment: true,
  inputModalities: ['text'],
  outputModalities: ['text'],
  ...over,
})

describe('ModelFieldSelect mapping', () => {
  test('keeps inheritance first, provider ordering stable, and context metadata visible', () => {
    const options = buildModelFieldOptions(
      [
        {
          providerId: 'openai',
          providerName: 'OpenAI',
          models: [model({ contextLength: 128_000 })],
        },
      ],
      'gpt-5.6',
    )

    expect(options.map((option) => option.value)).toEqual(['', 'gpt-5.6'])
    expect(options[0]?.label).toBe('Default — session model')
    expect(options[1]?.group).toBe('OpenAI')
    expect(options[1]?.description).toBe('128k context')
  })

  test('preserves a stale saved id as an explicit, clearable option', () => {
    const options = buildModelFieldOptions([], 'retired/model')

    expect(options[1]).toMatchObject({
      value: 'retired/model',
      group: 'Current (provider not connected)',
      hint: 'saved',
    })
  })
})
