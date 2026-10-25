import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_COMMAND_NAMES,
  groupCommandsByCategory,
  parseCommandArgs,
  resolveCommandSpec,
  SLASH_COMMANDS,
} from './slash-catalog'
import { parseControlCommand } from './service/slash-commands'

/** The habitual Claude Code commands, as the composer offers them. */
const CLIENT_COMMANDS = [
  'clear',
  'resume',
  'rename',
  'rewind',
  'plan',
  'context',
  'copy',
  'permissions',
  'config',
  'effort',
] as const

const spec = (name: string) => resolveCommandSpec(name)!

describe('Claude Code command spellings', () => {
  test('each habitual command exists, is reserved against skills, and runs in the client', () => {
    for (const name of CLIENT_COMMANDS) {
      expect(spec(name)?.scope).toBe('client')
      expect(BUILTIN_COMMAND_NAMES.has(name)).toBe(true)
      // A client command never parses as a server control command, so it cannot become a prompt.
      expect(parseControlCommand(`/${name}`)).toBeNull()
    }
  })

  test('commands that take no argument stay argless', () => {
    for (const name of ['clear', 'context', 'permissions', 'config'])
      expect(spec(name).argless).toBe(true)
  })

  test('/resume offers recent chats and lets an empty Enter open the picker', () => {
    const [chat] = spec('resume').args!
    expect(chat).toMatchObject({ name: 'chat', type: 'choice', dynamic: true, optional: true })
  })

  test('/rewind offers the chat’s own messages, one required choice', () => {
    const [message] = spec('rewind').args!
    expect(message).toMatchObject({ name: 'message', type: 'choice', dynamic: true })
    expect(message).not.toMatchObject({ optional: true })
  })

  test('/rename takes the title as text, /plan an optional task as text', () => {
    expect(spec('rename').args).toEqual([expect.objectContaining({ name: 'title', type: 'text' })])
    expect(spec('plan').args).toEqual([expect.objectContaining({ name: 'task', type: 'text' })])
  })

  test('/copy picks which reply, defaulting to the latest', () => {
    expect(spec('copy').args![0]).toMatchObject({
      name: 'reply',
      type: 'choice',
      dynamic: true,
      optional: true,
    })
  })

  test('/effort walks /model’s own agent and reasoning steps', () => {
    const model = spec('model').args!
    const effort = spec('effort').args!
    expect(effort.map((arg) => arg.name)).toEqual(['agent', 'reasoning'])
    expect(effort[0]).toEqual(model.find((arg) => arg.name === 'agent')!)
    expect(effort[1]).toMatchObject({ type: 'choice', dynamic: true, optional: false })
  })

  test('/help offers the command names it can describe', () => {
    const help = spec('help')
    expect(help.argless).toBeFalsy()
    expect(help.args![0]).toMatchObject({
      name: 'command',
      type: 'choice',
      dynamic: true,
      optional: true,
    })
    // A typed name is accepted as a crumb, as every dynamic choice is.
    expect(parseCommandArgs('plugin ', help.args!).chips.map((c) => c.option.value)).toEqual([
      'plugin',
    ])
  })

  test('/output-style offers styles and /memory takes the fact as text', () => {
    expect(spec('output-style').args![0]).toMatchObject({
      name: 'style',
      type: 'choice',
      dynamic: true,
      optional: true,
    })
    expect(spec('memory').args![0]).toMatchObject({ name: 'fact', type: 'text' })
  })

  test('/reload-plugins and /reload-skills run what /plugin reload runs, out of the menu', () => {
    for (const word of ['reload-plugins', 'reload-skills']) {
      expect(resolveCommandSpec(word)?.hidden).toBe(true)
      expect(BUILTIN_COMMAND_NAMES.has(word)).toBe(true)
      expect(parseControlCommand(`/${word}`)).toBe('reload-plugins')
    }
    const listed = groupCommandsByCategory().flatMap((group) => group.commands.map((c) => c.name))
    expect(listed).not.toContain('reload-plugins')
  })

  test('a compact command stays absent: the runtime checkpoints on its own', () => {
    expect(resolveCommandSpec('compact')).toBeUndefined()
  })

  test('every new command sits in a known category', () => {
    for (const name of CLIENT_COMMANDS)
      expect(SLASH_COMMANDS.some((c) => c.name === name && c.category)).toBe(true)
  })
})
