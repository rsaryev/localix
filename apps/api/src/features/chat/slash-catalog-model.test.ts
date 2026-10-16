import { describe, expect, test } from 'bun:test'
import { parseCommandArgs, resolveCommandSpec } from './slash-catalog'
import { MODEL_ARGS } from './slash-catalog-model'

describe('/model steps', () => {
  test('the catalog declares the picker order: agent, provider, model, settings', () => {
    expect(resolveCommandSpec('models')?.args?.map((arg) => arg.name)).toEqual([
      'agent',
      'provider',
      'model',
      'reasoning',
      'turns',
      'context',
    ])
  })

  test('a skipped step consumes no text, so the next step takes the first token', () => {
    const parsed = parseCommandArgs('conn-a gpt ', MODEL_ARGS, (name) => name === 'agent')
    expect(parsed.chips.map((chip) => [chip.spec.name, chip.option.value])).toEqual([
      ['provider', 'conn-a'],
      ['model', 'gpt'],
    ])
    expect(parsed.activeSpec?.name).toBe('reasoning')
  })

  test('skip sees the committed values, so a later step can depend on an earlier one', () => {
    const parsed = parseCommandArgs(
      'all conn-a gpt high ',
      MODEL_ARGS,
      (name, committed) =>
        (name === 'turns' || name === 'context') && committed.get('agent') === 'all',
    )
    expect(parsed.chips.map((chip) => chip.spec.name)).toEqual([
      'agent',
      'provider',
      'model',
      'reasoning',
    ])
    expect(parsed.activeSpec).toBeNull()
  })

  test('without a skip, every step is offered in order', () => {
    expect(parseCommandArgs('', MODEL_ARGS).activeSpec?.name).toBe('agent')
  })
})
