import { describe, expect, test } from 'bun:test'
import {
  detectActiveCommand,
  mergeDynamicSlashCommands,
  pastedCommandPrompt,
  selectedCommandPrompt,
} from './slashCommands'
import type { SlashCommand } from './SlashCommandMenu'

const cmd = (over: Partial<SlashCommand> & { trigger: string }): SlashCommand =>
  ({ id: over.trigger, title: over.trigger, ...over }) as unknown as SlashCommand

const model = cmd({ trigger: 'model' })
const loop = cmd({ trigger: 'loop' })
const scoped = cmd({ trigger: 'x', prefix: '/x:' })
const help = cmd({ trigger: 'help', prefix: '/help', argless: true })

describe('detectActiveCommand', () => {
  test('matches the default "/<trigger> " prefix and returns the trailing text', () => {
    expect(detectActiveCommand('/model gpt-4', [model])).toEqual({ command: model, text: 'gpt-4' })
  })

  test('requires the trailing space — a bare "/model" is not yet active', () => {
    expect(detectActiveCommand('/model', [model])).toBeNull()
  })

  test('honours a custom prefix', () => {
    expect(detectActiveCommand('/x:hello', [scoped])).toEqual({ command: scoped, text: 'hello' })
  })

  test('returns the first command whose prefix matches', () => {
    expect(detectActiveCommand('/loop do thing', [model, loop])).toEqual({
      command: loop,
      text: 'do thing',
    })
  })

  test('non-command text → null', () => {
    expect(detectActiveCommand('hello world', [model, loop])).toBeNull()
    expect(detectActiveCommand('/unknown stuff', [model])).toBeNull()
  })

  test('empty trailing text is preserved as ""', () => {
    expect(detectActiveCommand('/model ', [model])).toEqual({ command: model, text: '' })
  })

  test('argless commands require a token boundary', () => {
    expect(detectActiveCommand('/help', [help])).toEqual({ command: help, text: '' })
    expect(detectActiveCommand('/help topic', [help])).toEqual({ command: help, text: ' topic' })
    expect(detectActiveCommand('/helpful', [help])).toBeNull()
  })
})

describe('selectedCommandPrompt', () => {
  test('a skill selection becomes a one-shot slash command', () => {
    const skill = cmd({ trigger: 'code-review', kind: 'skill', skillName: 'code-review' })
    expect(selectedCommandPrompt(skill)).toBe('/code-review ')
  })

  test('preserves custom plugin command prefixes', () => {
    expect(selectedCommandPrompt(scoped)).toBe('/x:')
  })
})

describe('pastedCommandPrompt', () => {
  test('accepts a complete known command and preserves its full request', () => {
    const plugin = cmd({ trigger: 'plugin' })
    expect(pastedCommandPrompt('  /plugin install owner/repo\r\n', [plugin])).toBe(
      '/plugin install owner/repo',
    )
  })

  test('leaves ordinary and unknown pasted text to the textarea', () => {
    expect(pastedCommandPrompt('make a timer', [model])).toBeNull()
    expect(pastedCommandPrompt('/unknown make a timer', [model])).toBeNull()
  })
})

describe('mergeDynamicSlashCommands', () => {
  test('matches backend precedence and removes falsely actionable collisions', () => {
    const plugin = cmd({ trigger: 'feature-dev', id: 'plugin:feature-dev', kind: 'builtin' })
    const duplicatePlugin = cmd({
      trigger: 'FEATURE-DEV',
      id: 'plugin:feature-dev-duplicate',
      kind: 'builtin',
    })
    const shadowedSkill = cmd({
      trigger: 'feature-dev',
      id: 'skill:feature-dev',
      kind: 'skill',
    })
    const reservedAliasSkill = cmd({ trigger: 'cost', id: 'skill:cost', kind: 'skill' })
    const uniqueSkill = cmd({ trigger: 'audit', id: 'skill:audit', kind: 'skill' })

    expect(
      mergeDynamicSlashCommands(
        [plugin, duplicatePlugin],
        [shadowedSkill, reservedAliasSkill, uniqueSkill],
      ),
    ).toEqual([plugin, uniqueSkill])
  })
})
