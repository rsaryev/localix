import { describe, expect, test } from 'bun:test'
import { parseCommandArgs, filterArgOptions, type SlashArgSpec } from './slash-args'

const choice = (name: string, ...vals: string[]): SlashArgSpec => ({
  name,
  type: 'choice',
  options: vals.map((v) => ({ value: v, label: v })),
})

describe('parseCommandArgs', () => {
  test('first arg is active while still being typed (no trailing space)', () => {
    const r = parseCommandArgs('inst', [choice('action', 'install', 'remove')])
    expect(r.chips).toHaveLength(0)
    expect(r.activeSpec?.name).toBe('action')
    expect(r.activeText).toBe('inst')
  })

  test('a committed choice (followed by space) becomes a chip; cursor moves on', () => {
    const specs = [
      choice('action', 'install', 'remove'),
      { name: 'name', type: 'text' } as SlashArgSpec,
    ]
    const r = parseCommandArgs('install foo', specs)
    expect(r.chips).toHaveLength(1)
    expect(r.chips[0].option.value).toBe('install')
    expect(r.activeSpec?.type).toBe('text')
    expect(r.activeText).toBe('foo')
  })

  test('an unknown token keeps the choice arg active (not chipped)', () => {
    const r = parseCommandArgs('bogus ', [choice('action', 'install')])
    expect(r.chips).toHaveLength(0)
    expect(r.activeSpec?.name).toBe('action')
  })

  test('interval accepts a preset OR any duration token', () => {
    const specs: SlashArgSpec[] = [
      { name: 'every', type: 'interval', options: [{ value: '1h', label: '1h' }] },
    ]
    expect(parseCommandArgs('1h ', specs).chips[0].option.value).toBe('1h') // preset
    const r = parseCommandArgs('45m ', specs)
    expect(r.chips[0].option.value).toBe('45m') // free token via INTERVAL_TOKEN_RE
  })

  test('`when` gates an arg on an earlier chip value', () => {
    const specs: SlashArgSpec[] = [
      choice('action', 'install', 'marketplace'),
      {
        name: 'sub',
        type: 'choice',
        options: [{ value: 'add', label: 'add' }],
        when: { arg: 'action', equals: 'marketplace' },
      },
      { name: 'rest', type: 'text' },
    ]
    // action=install → the `sub` arg is skipped; text is next.
    const installed = parseCommandArgs('install x', specs)
    expect(installed.activeSpec?.name).toBe('rest')
    // action=marketplace → the gated `sub` arg becomes active.
    const market = parseCommandArgs('marketplace ', specs)
    expect(market.activeSpec?.name).toBe('sub')
  })

  test('a `when` LIST gates one arg on any of several earlier values', () => {
    // The alternative is one near-identical spec per accepting value, which is how a
    // placeholder ends up right for four sub-commands and stale for the fifth.
    const specs: SlashArgSpec[] = [
      choice('action', 'enable', 'disable', 'install'),
      {
        name: 'plugin',
        type: 'choice',
        dynamic: true,
        when: { arg: 'action', equals: ['enable', 'disable'] },
        placeholder: 'Pick an installed plugin…',
      },
      { name: 'source', type: 'text', when: { arg: 'action', equals: 'install' } },
    ]
    expect(parseCommandArgs('enable ', specs).activeSpec?.name).toBe('plugin')
    expect(parseCommandArgs('disable ', specs).activeSpec?.name).toBe('plugin')
    // An action outside the list skips it and lands on its own argument.
    expect(parseCommandArgs('install ', specs).activeSpec?.name).toBe('source')
  })

  test('all args satisfied → no active spec', () => {
    const r = parseCommandArgs('install ', [choice('action', 'install')])
    expect(r.activeSpec).toBeNull()
    expect(r.activeIndex).toBe(1)
  })

  test('an intermediate text arg consumes one token and advances like the server parser', () => {
    const specs: SlashArgSpec[] = [
      { name: 'target', type: 'text' },
      choice('mode', 'fast', 'safe'),
      { name: 'task', type: 'text' },
    ]
    const r = parseCommandArgs('api fast finish the work', specs)
    expect(r.chips.map((chip) => [chip.spec.name, chip.option.value])).toEqual([
      ['target', 'api'],
      ['mode', 'fast'],
    ])
    expect(r.activeSpec?.name).toBe('task')
    expect(r.activeText).toBe('finish the work')
  })
})

describe('an optional token recognised by its shape', () => {
  // Without it a closed choice after an optional `@handle` could not be typed: the choice kept
  // `@qa` as its unmatched partial and swallowed every space after it.
  const specs: SlashArgSpec[] = [
    { name: 'who', type: 'token', pattern: /^@\S+$/ },
    choice('level', 'low', 'high'),
  ]

  test('a complete matching token is committed, and the choice after it is reachable', () => {
    const r = parseCommandArgs('@qa hi', specs)
    expect(r.chips.map((chip) => chip.option.value)).toEqual(['@qa'])
    expect(r.activeSpec?.name).toBe('level')
    expect(r.activeText).toBe('hi')
  })

  test('absent or non-matching, it is skipped without consuming the text', () => {
    const r = parseCommandArgs('high ', specs)
    expect(r.chips.map((chip) => [chip.spec.name, chip.option.value])).toEqual([['level', 'high']])
    expect(r.activeSpec).toBeNull()
  })

  test('it never becomes the active argument, even while being typed', () => {
    const r = parseCommandArgs('@q', specs)
    expect(r.chips).toEqual([])
    expect(r.activeSpec?.name).toBe('level')
    expect(r.activeText).toBe('@q')
  })
})

describe('filterArgOptions', () => {
  const spec = choice('x', 'install', 'remove', 'list') as Extract<
    SlashArgSpec,
    { type: 'choice' | 'interval' }
  >
  test('empty query returns all', () => {
    expect(filterArgOptions(spec, '  ')).toHaveLength(3)
  })
  test('filters by value/label substring, case-insensitive', () => {
    expect(filterArgOptions(spec, 'IST').map((o) => o.value)).toEqual(['list'])
  })
})

describe('dynamic choice (combobox) free-entry', () => {
  // A dynamic arg's options load async (a plugin optionsScript), so the pure parser
  // can't validate against them — it must accept ANY token verbatim.
  const specs: SlashArgSpec[] = [
    { name: 'commit', type: 'choice', dynamic: true, options: [] },
    { name: 'rest', type: 'text' },
  ]
  test('commits an arbitrary token (a sha not in options) as a chip, preserving case', () => {
    const r = parseCommandArgs('AbC123def focus text', specs)
    expect(r.chips.map((c) => c.option.value)).toEqual(['AbC123def'])
    expect(r.activeSpec?.name).toBe('rest')
    expect(r.activeText).toBe('focus text')
  })
  test('stays active (uncommitted) while still typing the token', () => {
    const r = parseCommandArgs('AbC123', specs)
    expect(r.chips).toHaveLength(0)
    expect(r.activeSpec?.name).toBe('commit')
    expect(r.activeText).toBe('AbC123')
  })
})

describe('a dynamic choice as the SERVER actually sends it', () => {
  /*
   * With no `options` key at all — which is the real wire shape, not `options: []`.
   *
   * `plugins/commands.ts` builds a plugin arg as `...(a.options ? { options: a.options } : {})`, so
   * an arg with an `optionsScript` and no static list arrives without the property. The type said
   * `options` was always there, the wire schema said it was optional, and both readers below
   * dereferenced it — so the composer threw `undefined is not an object` as soon as the parser
   * reached such an arg. The fixtures above never caught it because they were more generous than the
   * server: an explicit empty array where production sends nothing.
   *
   * Reaching one is ordinary, not exotic: an intermediate TEXT arg consumes a single token, so any
   * command shaped `<choice> <text> <dynamic…>` lands here the moment the text is given two words.
   */
  const specs: SlashArgSpec[] = [
    { name: 'scope', type: 'choice', options: [{ value: 'new', label: 'New' }] },
    { name: 'brief', type: 'text' },
    { name: 'board', type: 'choice', dynamic: true },
  ]

  test('parses instead of throwing, and accepts the token verbatim', () => {
    const r = parseCommandArgs('new bakery kreuzberg', specs)
    expect(r.chips.map((c) => `${c.spec.name}=${c.option.value}`)).toEqual([
      'scope=new',
      'brief=bakery',
    ])
    expect(r.activeSpec?.name).toBe('board')
    expect(r.activeText).toBe('kreuzberg')
  })

  test('its menu is empty rather than an exception', () => {
    const board = specs[2] as Extract<SlashArgSpec, { type: 'choice' }>
    expect(filterArgOptions(board, '')).toEqual([])
    expect(filterArgOptions(board, 'main')).toEqual([])
  })
})
