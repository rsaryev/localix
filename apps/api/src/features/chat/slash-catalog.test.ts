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
} from './slash-catalog'

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
    // `/help <command>` is advertised, so the command takes an argument.
    expect(help?.argless).toBeFalsy()
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
    // The catalog ships no hidden command now, so a synthetic one keeps the support verified.
    const catalog = [
      ...SLASH_COMMANDS,
      { ...SLASH_COMMANDS[0]!, name: 'secret-power', hidden: true },
    ]
    const visible = groupCommandsByCategory(catalog)
      .flatMap((g) => g.commands)
      .map((c) => c.name)
    expect(visible).not.toContain('secret-power')
    const all = groupCommandsByCategory(catalog, { includeHidden: true })
      .flatMap((g) => g.commands)
      .map((c) => c.name)
    expect(all).toContain('secret-power')
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
    expect(resolveCommandSpec('clear')?.scope).toBe('client')
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
 * Making a mini app moved to an authoring plugin from the marketplace, and
 * `/mini-app create` was removed — but the menu still offered `create`, so picking it sent a
 * command that no longer exists. `/mini-app` offers only what Localix does to installed apps.
 */
describe('/mini-app actions', () => {
  const miniApp = SLASH_COMMANDS.find((c) => c.name === 'mini-app')!
  const actions = miniApp.args!.find((arg) => arg.name === 'action')!

  test('the menu offers no create, and nothing waits for a create description', () => {
    expect(actions.type === 'choice' && actions.options?.map((o) => o.value)).toEqual([
      'list',
      'enable',
      'disable',
      'remove',
      'reload',
      'catalog',
    ])
    // `create` is not an action: the composer keeps offering the menu, not a description field.
    expect(parseCommandArgs('create ', miniApp.args!).activeSpec?.name).toBe('action')
    expect(miniApp.description).not.toMatch(/create/iu)
  })
})
