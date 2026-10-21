import { describe, expect, test } from 'bun:test'
import type { SlashCommand } from './SlashCommandMenu'
import {
  matchSlashCommand,
  filterAndRankSlashCommands,
  commandGroupRank,
  SlashMatchTier,
} from './slashCommandMatch'

/** Minimal SlashCommand fixture — only the fields the matcher reads. */
const cmd = (over: Partial<SlashCommand> & { trigger: string }): SlashCommand =>
  ({
    id: over.id ?? over.trigger,
    title: over.title ?? over.trigger,
    ...over,
  }) as unknown as SlashCommand

const triggers = (list: SlashCommand[]) => list.map((c) => c.trigger)

describe('matchSlashCommand', () => {
  test('exact trigger match', () => {
    expect(matchSlashCommand('model', cmd({ trigger: 'model' }))).toMatchObject({
      tier: SlashMatchTier.ExactTrigger,
      field: 'trigger',
    })
  })

  test('prefix match on trigger', () => {
    expect(matchSlashCommand('mod', cmd({ trigger: 'model' }))).toMatchObject({
      tier: SlashMatchTier.Prefix,
      field: 'trigger',
    })
  })

  test('prefix match on title when trigger does not prefix-match', () => {
    expect(
      matchSlashCommand('sess', cmd({ trigger: 'status', title: 'Session status' })),
    ).toMatchObject({
      tier: SlashMatchTier.Prefix,
      field: 'title',
    })
  })

  test('substring match', () => {
    expect(matchSlashCommand('ode', cmd({ trigger: 'model' }))).toMatchObject({
      tier: SlashMatchTier.Substring,
      field: 'trigger',
      // The menu highlights these — the ranked substring m[ode]l, not a fresh greedy scan.
      positions: new Set([1, 2, 3]),
    })
  })

  test('fuzzy subsequence match (the new capability): "gtf" → "go-to-file"', () => {
    expect(matchSlashCommand('gtf', cmd({ trigger: 'go-to-file' }))).toMatchObject({
      tier: SlashMatchTier.Subsequence,
      field: 'trigger',
    })
  })

  test('no match returns null', () => {
    expect(matchSlashCommand('xyz', cmd({ trigger: 'model', title: 'Model' }))).toBeNull()
  })

  test('is case-insensitive on both trigger and title', () => {
    expect(matchSlashCommand('mod', cmd({ trigger: 'MODEL' }))?.tier).toBe(SlashMatchTier.Prefix)
  })

  test('single-char weak tiers still match on the web (no 2+ gate, unlike the leaf default)', () => {
    // A single non-prefix char must still match by substring on the web composer.
    expect(matchSlashCommand('o', cmd({ trigger: 'model' }))).toMatchObject({
      tier: SlashMatchTier.Substring,
      field: 'trigger',
    })
    // A single char that doesn't appear anywhere still yields no match.
    expect(matchSlashCommand('z', cmd({ trigger: 'model' }))).toBeNull()
  })
})

describe('commandGroupRank', () => {
  test('built-in < plugin < skill', () => {
    expect(commandGroupRank(cmd({ trigger: 'model' }))).toBe(0)
    expect(commandGroupRank(cmd({ trigger: 'web', id: 'plugin:web' }))).toBe(1)
    expect(commandGroupRank(cmd({ trigger: 'deep', kind: 'skill' }))).toBe(2)
  })
})

describe('filterAndRankSlashCommands', () => {
  test('empty query returns the full list in group order (built-ins → plugins → skills), unchanged', () => {
    const list = [
      cmd({ trigger: 'deep', kind: 'skill' }),
      cmd({ trigger: 'web', id: 'plugin:web' }),
      cmd({ trigger: 'model' }),
      cmd({ trigger: 'status' }),
    ]
    // built-ins keep their original relative order (stable), then plugins, then skills.
    expect(triggers(filterAndRankSlashCommands('', list))).toEqual([
      'model',
      'status',
      'web',
      'deep',
    ])
  })

  test('empty query preserves original order within a group (stable sort)', () => {
    const list = [
      cmd({ trigger: 'status' }),
      cmd({ trigger: 'model' }),
      cmd({ trigger: 'compact' }),
    ]
    expect(triggers(filterAndRankSlashCommands('', list))).toEqual(['status', 'model', 'compact'])
  })

  test('tiers rank exact > prefix > substring > subsequence', () => {
    const list = [
      cmd({ trigger: 'mao' }), // subsequence-only of "mo" (no contiguous "mo")
      cmd({ trigger: 'xmoy' }), // substring "mo"
      cmd({ trigger: 'model' }), // prefix "mo"
      cmd({ trigger: 'mo' }), // exact "mo"
    ]
    // query "mo": exact(mo) > prefix(model) > substring(xmoy) > subsequence(mao)
    expect(triggers(filterAndRankSlashCommands('mo', list))).toEqual(['mo', 'model', 'xmoy', 'mao'])
  })

  test('a today-substring match never ranks below a new subsequence-only match', () => {
    // "gtf": plugin "gitfetch" substring-matches (contains "gtf"? no) — use a clear substring case.
    // Built-in "xgtfy" contains "gtf" (substring, tier 2); plugin "go-to-file" is subsequence-only (tier 3).
    const list = [
      cmd({ trigger: 'go-to-file', id: 'plugin:go-to-file' }), // subsequence-only for "gtf"
      cmd({ trigger: 'xgtfy' }), // substring for "gtf"
    ]
    const ranked = triggers(filterAndRankSlashCommands('gtf', list))
    // Even though the plugin appears first in the list AND (under the old group sort)
    // built-ins outrank plugins, tier is primary: the substring hit must come first.
    expect(ranked).toEqual(['xgtfy', 'go-to-file'])
  })

  test('within a tier, group rank is the tiebreak (built-in before plugin before skill)', () => {
    const list = [
      cmd({ trigger: 'mskill', kind: 'skill' }), // prefix "m", skill
      cmd({ trigger: 'mplugin', id: 'plugin:mplugin' }), // prefix "m", plugin
      cmd({ trigger: 'mbuiltin' }), // prefix "m", built-in
    ]
    // All three are prefix (tier 1) for "m"; group rank orders them builtin < plugin < skill.
    const ranked = triggers(filterAndRankSlashCommands('m', list))
    expect(ranked).toEqual(['mbuiltin', 'mplugin', 'mskill'])
  })

  test('within a tier and group, original order is preserved', () => {
    const list = [cmd({ trigger: 'mbeta' }), cmd({ trigger: 'malpha' })]
    // both prefix "m", both built-in → original order kept
    expect(triggers(filterAndRankSlashCommands('m', list))).toEqual(['mbeta', 'malpha'])
  })

  test('everything the old substring filter matched still matches (title or trigger substring)', () => {
    const list = [
      cmd({ trigger: 'model', title: 'Pick model' }),
      cmd({ trigger: 'status', title: 'Session status' }),
    ]
    // "tat" is a substring of the "status" trigger; "ick" a substring of the "model" title.
    expect(triggers(filterAndRankSlashCommands('tat', list))).toEqual(['status'])
    expect(triggers(filterAndRankSlashCommands('ick', list))).toEqual(['model'])
  })

  test('non-matching commands are filtered out', () => {
    const list = [cmd({ trigger: 'model' }), cmd({ trigger: 'status' })]
    expect(filterAndRankSlashCommands('zzz', list)).toEqual([])
  })
})

describe('importance order', () => {
  const list = [
    cmd({ trigger: 'help', category: 'info' }),
    cmd({ trigger: 'loop', category: 'autonomous' }),
    cmd({ trigger: 'fork', category: 'context' }),
    cmd({ trigger: 'model', category: 'config' }),
    cmd({ id: 'plugin:board', trigger: 'board' }),
    cmd({ id: 'plugin:start', trigger: 'start', featured: true }),
  ]

  test('an empty query puts the featured command first, then the built-ins by section importance', () => {
    expect(filterAndRankSlashCommands('', list).map((c) => c.trigger)).toEqual([
      'start',
      'model',
      'fork',
      'loop',
      'help',
      'board',
    ])
  })

  test('a featured command also leads its own match tier', () => {
    expect(filterAndRankSlashCommands('t', list)[0]?.trigger).toBe('start')
  })
})
