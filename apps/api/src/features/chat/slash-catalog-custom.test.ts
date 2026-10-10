import { expect, test } from 'bun:test'
import {
  groupCommandsByCategory,
  resolveCommandSpec,
  suggestCommands,
  type SlashCommandSpec,
} from './slash-catalog'

test('custom catalogs resolve hidden aliases while suggestions and groups retain visible specs', () => {
  const spec = (name: string, hidden?: boolean): SlashCommandSpec => ({
    name,
    aliases: ['match'],
    title: name,
    description: name,
    scope: 'client',
    category: 'info',
    hidden,
  })
  const hidden = spec('hidden', true)
  const zulu = spec('zulu')
  const alpha = spec('alpha')
  const commands = [hidden, zulu, alpha]
  const snapshot = structuredClone(commands)

  expect(resolveCommandSpec(' //MATCH ', commands)).toBe(hidden)
  const suggestions = suggestCommands('match', { commands })
  expect(suggestions).toHaveLength(2)
  expect(suggestions[0]).toBe(alpha)
  expect(suggestions[1]).toBe(zulu)
  const groups = groupCommandsByCategory(commands)
  expect(groups).toHaveLength(1)
  expect(groups[0]!.commands[0]).toBe(zulu)
  expect(groups[0]!.commands[1]).toBe(alpha)
  expect(groupCommandsByCategory(commands, { includeHidden: true })[0]!.commands[0]).toBe(hidden)
  expect(commands).toEqual(snapshot)
  expect(commands[0]).toBe(hidden)
})
