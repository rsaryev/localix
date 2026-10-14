import { describe, expect, test } from 'bun:test'
import {
  SLASH_COMMANDS,
  BUILTIN_COMMAND_NAMES,
  SLASH_CATEGORIES,
  commandUsage,
  groupCommandsByCategory,
  resolveCommandSpec,
  suggestCommands,
  describeCommand,
  parseCommandArgs,
  filterArgOptions,
} from './slash-catalog'
import { REASONING_EFFORT_OPTIONS } from '@localixai/agent'

// The catalog is the single source of truth for slash commands across the web
// composer and the /command handlers. These guard against the drift
// that catalog data is prone to: duplicate names, an alias that shadows another
// command, or BUILTIN_COMMAND_NAMES falling out of sync with the catalog.

describe('SLASH_COMMANDS catalog integrity', () => {
  const allNames = SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])])

  test('every name + alias is globally unique (no shadowing)', () => {
    const counts = allNames.reduce<Record<string, number>>(
      (m, n) => ((m[n] = (m[n] ?? 0) + 1), m),
      {},
    )
    const duplicates = Object.entries(counts)
      .filter(([, c]) => c > 1)
      .map(([n]) => n)
    expect(duplicates).toEqual([])
  })

  test('names have no leading slash and are non-empty', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.name.startsWith('/')).toBe(false)
    }
  })

  test('BUILTIN_COMMAND_NAMES contains exactly every name + alias', () => {
    expect(BUILTIN_COMMAND_NAMES.size).toBe(new Set(allNames).size)
    for (const n of allNames) expect(BUILTIN_COMMAND_NAMES.has(n)).toBe(true)
  })

  test('an argless command declares no args, and arg names are unique per command', () => {
    for (const c of SLASH_COMMANDS) {
      if (c.argless) expect(c.args ?? []).toHaveLength(0)
      const argNames = (c.args ?? []).map((a) => a.name)
      expect(new Set(argNames).size).toBe(argNames.length)
    }
  })

  test('every command has a category listed in SLASH_CATEGORIES', () => {
    const ids = new Set(SLASH_CATEGORIES.map((c) => c.id))
    for (const c of SLASH_COMMANDS) expect(ids.has(c.category)).toBe(true)
  })

  test('a /help command exists in the Info section', () => {
    const help = SLASH_COMMANDS.find((c) => c.name === 'help')
    expect(help?.category).toBe('info')
    expect(help?.argless).toBe(true)
  })
})

describe('command grouping + usage', () => {
  test('groupCommandsByCategory covers every visible command exactly once, in category order', () => {
    const groups = groupCommandsByCategory()
    const grouped = groups.flatMap((g) => g.commands)
    const visible = SLASH_COMMANDS.filter((c) => !c.hidden)
    expect(grouped.length).toBe(visible.length)
    expect(new Set(grouped.map((c) => c.name)).size).toBe(visible.length)
    // Category order matches the declared catalog order (empty groups dropped).
    const order = SLASH_CATEGORIES.map((c) => c.id)
    const seen = groups.map((g) => order.indexOf(g.category.id))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  test('hidden commands are excluded by default, included on request', () => {
    const hiddenNames = SLASH_COMMANDS.filter((c) => c.hidden).map((c) => c.name)
    // LOAD-BEARING. The catalog carries exactly ONE `hidden: true` command, so without this the
    // two loops below are one edit from iterating over nothing and asserting nothing — dropping
    // that flag would leave hidden-command support entirely unverified while the /help menu
    // quietly starts leaking power-user commands. A loop over an empty list is not a guard.
    expect(hiddenNames.length).toBeGreaterThan(0)
    const visible = groupCommandsByCategory()
      .flatMap((g) => g.commands)
      .map((c) => c.name)
    for (const n of hiddenNames) expect(visible).not.toContain(n)
    const all = groupCommandsByCategory(SLASH_COMMANDS, { includeHidden: true })
      .flatMap((g) => g.commands)
      .map((c) => c.name)
    for (const n of hiddenNames) expect(all).toContain(n)
  })

  test('commandUsage renders the command token and its arg signature', () => {
    // An argless command is just its token.
    const fork = SLASH_COMMANDS.find((c) => c.name === 'fork')!
    expect(commandUsage(fork)).toBe('/fork')
  })
})

describe('/help <command> detail helpers', () => {
  test('resolveCommandSpec folds slashes, case, and aliases', () => {
    expect(resolveCommandSpec('/Usage')?.name).toBe('usage')
    expect(resolveCommandSpec('clear')).toBeUndefined()
    // `cost` is an alias of `usage`.
    expect(resolveCommandSpec('cost')?.name).toBe('usage')
    expect(resolveCommandSpec('models')?.name).toBe('model')
    expect(resolveCommandSpec('nope')).toBeUndefined()
    expect(resolveCommandSpec('')).toBeUndefined()
  })

  test('suggestCommands proposes near matches for a typo, none for gibberish', () => {
    const near = suggestCommands('usgae').map((c) => c.name)
    expect(near).toContain('usage')
    const alias = suggestCommands('costs').map((c) => c.name)
    // `costs` is closest to the `cost` alias of `usage`.
    expect(alias).toContain('usage')
    expect(suggestCommands('zzzzzqqqq')).toEqual([])
    // Hidden power-user commands are never suggested.
    expect(suggestCommands('reasoning').every((c) => !c.hidden)).toBe(true)
  })

  test('describeCommand surfaces usage, category, aliases, and per-arg options', () => {
    const usage = SLASH_COMMANDS.find((c) => c.name === 'usage')!
    const d = describeCommand(usage)
    expect(d.name).toBe('usage')
    expect(d.categoryLabel).toBe('Info')
    expect(d.aliases).toContain('cost')

    // A conditional arg carries its gating condition through.
    const plugin = describeCommand(SLASH_COMMANDS.find((c) => c.name === 'plugin')!)
    const msub = plugin.args.find((a) => a.name === 'msub')!
    expect(msub.when).toEqual({ arg: 'action', equals: 'marketplace' })
  })
})

/**
 * `/plugin` used to end in ONE free-text argument placeheld `<src> · <name> ·
 * <owner/repo>`, so every sub-command advertised every other sub-command's input:
 * `disable` offered a git URL it cannot take and never offered the installed names
 * it can. Each action now declares what it accepts.
 */
describe('/plugin argument routing', () => {
  const pluginArgs = SLASH_COMMANDS.find((c) => c.name === 'plugin')!.args!
  /** The argument the composer activates once `action` (and maybe `msub`) is committed. */
  const argFor = (text: string) => parseCommandArgs(text, pluginArgs).activeSpec

  test('the actions that name something installed get ONE shared dynamic picker', () => {
    for (const action of ['enable', 'disable', 'remove', 'update', 'details']) {
      const spec = argFor(`${action} `)
      expect(spec?.name).toBe('plugin')
      expect(spec?.type).toBe('choice')
      expect(spec?.type === 'choice' && spec.dynamic).toBe(true)
    }
  })

  test('install, validate and marketplace-remove each get their own dynamic source', () => {
    expect(argFor('install ')?.name).toBe('source')
    expect(argFor('validate ')?.name).toBe('target')
    expect(argFor('marketplace remove ')?.name).toBe('market')
  })

  test('a marketplace source stays free text — it is pasted, not picked', () => {
    expect(argFor('marketplace add ')?.type).toBe('text')
  })

  test('an action that takes no argument leaves nothing active', () => {
    expect(argFor('list ')).toBeNull()
    expect(argFor('reload ')).toBeNull()
  })

  test('`init` is gone — the scaffold is being rebuilt, and a half-offered action is worse', () => {
    const actions = pluginArgs.find((arg) => arg.name === 'action')
    expect(actions?.type === 'choice' && actions.options?.map((o) => o.value)).not.toContain('init')
  })

  test('no argument advertises the old catch-all placeholder', () => {
    for (const arg of pluginArgs) {
      expect(arg.placeholder ?? '').not.toContain('<owner/repo>· <name>')
      expect(arg.placeholder ?? '').not.toBe('<src> · <name> · <owner/repo>')
    }
  })
})

/**
 * `/reasoning` took its effort as free text: the composer offered no levels and a typo came back
 * only as a usage line. It is a pick now, from the agent package's one scale, and every form the
 * handler accepted before still parses.
 */
describe('/reasoning effort is a pick', () => {
  const reasoningArgs = SLASH_COMMANDS.find((c) => c.name === 'reasoning')!.args!
  const parse = (text: string) => parseCommandArgs(text, reasoningArgs)
  const committed = (text: string) =>
    Object.fromEntries(parse(text).chips.map((chip) => [chip.spec.name, chip.option.value]))

  test('offers every level, with the labels and descriptions the model picker shows', () => {
    const effort = parse('').activeSpec
    expect(effort?.name).toBe('effort')
    expect(effort?.type === 'choice' && effort.options).toEqual(
      REASONING_EFFORT_OPTIONS.map(({ value, label, description }) => ({
        value,
        label,
        description,
      })),
    )
    expect(effort?.type === 'choice' && filterArgOptions(effort, 'hi').map((o) => o.value)).toEqual(
      ['high', 'xhigh'],
    )
  })

  test('the bare and the tasked forms still parse', () => {
    expect(committed('high ')).toEqual({ effort: 'high' })
    // Case-insensitive, as the free-text form was.
    expect(committed('Low ')).toEqual({ effort: 'low' })
    const tasked = parse('max refactor the parser')
    expect(committed('max refactor the parser')).toEqual({ effort: 'max' })
    expect(tasked.activeSpec?.name).toBe('task')
    expect(tasked.activeText).toBe('refactor the parser')
  })

  test('an addressee before the effort is still accepted, and only once it is complete', () => {
    expect(committed('@qa high ')).toEqual({ participant: '@qa', effort: 'high' })
    // A half-typed handle is still being typed: it stays with the active effort pick rather than
    // being committed (or eaten) as something it is not yet.
    const partial = parse('@q')
    expect(partial.chips).toEqual([])
    expect(partial.activeSpec?.name).toBe('effort')
    expect(partial.activeText).toBe('@q')
    // A word that is not a handle is never mistaken for one.
    expect(committed('medium ')).toEqual({ effort: 'medium' })
  })

  test('usage shows the optional addressee and the level set', () => {
    const reasoning = SLASH_COMMANDS.find((c) => c.name === 'reasoning')!
    expect(commandUsage(reasoning)).toBe(
      '/reasoning [participant] <off|minimal|low|medium|high|xhigh|…> [task]',
    )
  })
})
