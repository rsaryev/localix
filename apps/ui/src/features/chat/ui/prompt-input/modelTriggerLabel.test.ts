import { describe, expect, test } from 'bun:test'

import { modelTriggerLabel } from './modelTriggerLabel'

const connection = { providerId: 'openai' }
const openaiModels = [{ providerId: 'openai' }]

describe('model trigger label', () => {
  test('a model the catalog dropped is named as gone, not as "Select model"', () => {
    expect(
      modelTriggerLabel({
        selectedModel: undefined,
        value: 'openai/gpt-retired',
        models: openaiModels,
        activeConnection: connection,
      }),
    ).toBe('openai/gpt-retired is no longer available')
  })

  test('a catalog still loading claims nothing', () => {
    expect(
      modelTriggerLabel({
        selectedModel: undefined,
        value: 'openai/gpt-retired',
        models: [],
        activeConnection: connection,
      }),
    ).toBe('Select model')
  })

  test('no stored model, no connection, and a found model keep their words', () => {
    expect(
      modelTriggerLabel({
        selectedModel: undefined,
        value: '',
        models: openaiModels,
        activeConnection: connection,
      }),
    ).toBe('Select model')
    expect(
      modelTriggerLabel({
        selectedModel: undefined,
        value: 'x',
        models: openaiModels,
        activeConnection: null,
      }),
    ).toBe('Choose model')
    expect(
      modelTriggerLabel({
        selectedModel: { name: 'GPT-5' },
        value: 'openai/gpt-5',
        models: openaiModels,
        activeConnection: connection,
      }),
    ).toBe('GPT-5')
  })
})
