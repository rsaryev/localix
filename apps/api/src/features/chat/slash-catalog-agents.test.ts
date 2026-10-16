import { describe, expect, test } from 'bun:test'
import { AGENTS_ARGS } from './slash-catalog-agents'
import { parseCommandArgs, filterArgOptions } from './slash-args'
import { tokenizeCommandText } from './slash-command-tokens'
import { parseAgentsCommand } from './service/agents-command-input'

const bodyOf = (text: string) => {
  const parsed = parseCommandArgs(text, AGENTS_ARGS)
  return [...parsed.chips.map((chip) => chip.option.value), parsed.activeText].join(' ')
}

describe('agents tokens across composer and server', () => {
  test('a fractional value stays one token through every crumb without truncation or rounding', () => {
    const text = 'edit @qa --priority 0.5 '
    const parsed = parseCommandArgs(text, AGENTS_ARGS)
    expect(parsed.chips.map((chip) => chip.option.value)).toEqual([
      'edit',
      '@qa',
      '--priority',
      '0.5',
    ])
    expect(parsed.chips.map((chip) => chip.spec.name)).toEqual([
      'action',
      'agent',
      'flag:priority',
      'priority',
    ])
    expect(tokenizeCommandText(`/agents ${bodyOf(text)}`).at(-1)?.value).toBe('0.5')
    expect(() => parseAgentsCommand(`/agents ${bodyOf(text)}`)).toThrow(/whole number/)
    const editing = parseCommandArgs('edit @qa --priority 0.5', AGENTS_ARGS)
    expect(editing.activeSpec?.name).toBe('priority')
    expect(editing.activeText).toBe('0.5')
  })
  test('arbitrary flag order, quoting, escapes and multiline values survive rebuilding', () => {
    const body =
      'create reviewer --priority -1 --instructions "Check:\n- $HOME\n- \\"quoted\\"" --description "Reviews migrations" '
    expect(parseAgentsCommand(`/agents ${bodyOf(body)}`)).toMatchObject({
      action: 'create',
      args: ['reviewer'],
      fields: {
        leadershipPriority: -1,
        description: 'Reviews migrations',
        instructions: 'Check:\n- $HOME\n- "quoted"',
      },
    })
    const quoted = tokenizeCommandText(body).find((token) => token.value.startsWith('Check:'))!
    expect(quoted.closed).toBe(true)
    expect(quoted.raw).toContain('\\"quoted\\"')
  })
  test('completion follows the action, typed flag prefix and active value', () => {
    const flags = parseCommandArgs('edit @qa --pri', AGENTS_ARGS)
    expect(flags.activeSpec?.type).toBe('choice')
    if (flags.activeSpec?.type === 'choice')
      expect(filterArgOptions(flags.activeSpec, flags.activeText).map((row) => row.value)).toEqual([
        '--priority',
      ])
    const priority = parseCommandArgs('edit @qa --priority ', AGENTS_ARGS)
    expect(priority.activeSpec).toMatchObject({ name: 'priority', type: 'choice' })
    if (priority.activeSpec?.type === 'choice')
      expect(filterArgOptions(priority.activeSpec, '').map((row) => row.value)).toEqual([
        '-2',
        '-1',
        '0',
        '1',
        '2',
      ])
    const done = parseCommandArgs('edit @qa --priority 0 ', AGENTS_ARGS)
    if (done.activeSpec?.type === 'choice')
      expect(done.activeSpec.options?.map((row) => row.value)).not.toContain('--priority')
    const deletion = parseCommandArgs('delete @qa ', AGENTS_ARGS)
    expect(deletion.activeSpec).toMatchObject({
      type: 'choice',
      optional: true,
      options: [{ value: '--confirm' }],
    })
  })
  test('unquoted text values run to the next flag and completion resumes after them', () => {
    // Spaces keep the prose in the editable field; only a following `--` turns it into a crumb.
    const typing = parseCommandArgs('create qa --instructions Check the sch', AGENTS_ARGS)
    expect(typing.chips.map((chip) => chip.option.value)).toEqual([
      'create',
      'qa',
      '--instructions',
    ])
    expect(typing.activeSpec).toMatchObject({ name: 'instructions', type: 'text' })
    expect(typing.activeText).toBe('Check the sch')
    expect(parseCommandArgs('create --instructions a b ', AGENTS_ARGS).activeText).toBe('a b ')
    const literal = parseCommandArgs('create --instructions keep "--this" too --pri', AGENTS_ARGS)
    expect(literal.chips.at(-1)?.option.description).toBe('keep --this too')
    expect(parseAgentsCommand('/agents create --instructions keep "--this" too').fields).toEqual({
      instructions: 'keep --this too',
    })
    const next = parseCommandArgs('create qa --instructions Check the schema --pri', AGENTS_ARGS)
    expect(next.chips.at(-1)?.option).toMatchObject({
      value: 'Check the schema',
      description: 'Check the schema',
    })
    if (next.activeSpec?.type === 'choice')
      expect(filterArgOptions(next.activeSpec, next.activeText).map((row) => row.value)).toEqual([
        '--priority',
      ])
    else throw new Error('expected the flag menu')
    const body =
      'create qa --instructions Check the schema --priority -2 --description "Reviews  SQL" '
    expect(parseAgentsCommand(`/agents ${bodyOf(body)}`)).toMatchObject({
      args: ['qa'],
      fields: {
        instructions: 'Check the schema',
        leadershipPriority: -2,
        description: 'Reviews  SQL',
      },
    })
  })
  test('an unknown token becomes its own crumb instead of stalling later completion', () => {
    const parsed = parseCommandArgs('edit @qa --mystery data --desc', AGENTS_ARGS)
    expect(parsed.chips.slice(2).map((chip) => chip.spec.name)).toEqual(['unknown', 'unknown'])
    if (parsed.activeSpec?.type === 'choice')
      expect(
        filterArgOptions(parsed.activeSpec, parsed.activeText).map((row) => row.value),
      ).toEqual(['--description'])
    else throw new Error('expected the flag menu')
  })
  test('the flag placeholder names what remains and stops offering once every flag is used', () => {
    expect(parseCommandArgs('edit @qa ', AGENTS_ARGS).activeSpec?.placeholder).toContain(
      'Optional flag',
    )
    const two = parseCommandArgs('create --description one --', AGENTS_ARGS)
    expect(two.activeSpec?.placeholder).toBe(
      'Optional --instructions or --priority — Tab to add, Enter to run…',
    )
    const done = parseCommandArgs(
      'create --description one --instructions two --priority -2 ',
      AGENTS_ARGS,
    )
    expect(done.activeSpec).toMatchObject({ placeholder: 'Enter to run…', options: [] })
  })
  test('create takes a handle or a request in its own words before any option', () => {
    const empty = parseCommandArgs('create ', AGENTS_ARGS)
    expect(empty.activeSpec?.placeholder).toContain('Describe the agent')
    expect(empty.activeSpec?.type).toBe('choice')
    const prose = parseCommandArgs("create a reviewer that doesn't skip ", AGENTS_ARGS)
    expect(prose.chips.map((chip) => chip.option.value)).toEqual(['create'])
    expect(prose.activeSpec).toMatchObject({ name: 'request', type: 'text' })
    expect(prose.activeText).toBe("a reviewer that doesn't skip ")
    const handle = parseCommandArgs('create qa --desc', AGENTS_ARGS)
    expect(handle.chips.map((chip) => chip.spec.name)).toEqual(['action', 'request'])
    expect(handle.activeText).toBe('--desc')
    const flagFirst = parseCommandArgs('create --pri', AGENTS_ARGS)
    expect(flagFirst.chips).toHaveLength(1)
    expect(flagFirst.activeText).toBe('--pri')
  })
  test('unfinished quotes, unknown flags, extra arguments and duplicate flags remain visible', () => {
    for (const body of [
      'edit @qa --instructions "unfinished words',
      'edit @qa --mystery data',
      'edit @qa --instructions two words --priority',
      'edit @qa --priority 0 --priority -1 ',
      'list unexpected arguments',
    ]) {
      const reconstructed = bodyOf(body).trim()
      expect(reconstructed).toBe(body.trim())
    }
  })
})
