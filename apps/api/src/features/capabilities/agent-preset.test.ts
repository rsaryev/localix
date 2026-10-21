import { describe, expect, test } from 'bun:test'
import { agentPresetRules, hasAgentPreset } from './agent-preset'
import { evaluate, verdictIn as scopeVerdict, type Rule } from '../agent-core/capability-rule'

/**
 * What the scope answers for one capability, through the REAL matcher.
 *
 * Deliberately not a local reimplementation of the glob and the last-match rule: a test that
 * carries its own copy of the semantics can pass while the resolver disagrees with it, which
 * is the one failure a preset test must not have.
 */
const verdictIn = (rules: Rule[], action: string): string =>
  scopeVerdict(rules, action, '*')?.effect ?? 'allow'

describe('agentPresetRules', () => {
  test('a record that states nothing seeds nothing', () => {
    // Most agents. Their scope must inherit exactly as it does today — a preset that wrote
    // rows for them would turn "no opinion" into a decision nobody made.
    expect(agentPresetRules({})).toEqual([])
    expect(hasAgentPreset({})).toBe(false)
  })

  test('a positive list CLOSES its kind', () => {
    // Allows alone narrow nothing: absence of a rule already means allowed. The closing deny
    // is what makes "the tools this role uses are read and search" mean the others are off.
    const rules = agentPresetRules({ tools: ['read', 'search'] })
    expect(rules[0]).toEqual({ action: 'tool:*', resource: '*', effect: 'deny' })
    expect(verdictIn(rules, 'tool:read')).toBe('allow')
    expect(verdictIn(rules, 'tool:search')).toBe('allow')
    expect(verdictIn(rules, 'tool:write')).toBe('deny')
  })

  test('an empty positive list is "none", not "inherit"', () => {
    const rules = agentPresetRules({ tools: [] })
    expect(rules).toHaveLength(1)
    expect(verdictIn(rules, 'tool:read')).toBe('deny')
  })

  test('a negative list subtracts on top and wins', () => {
    // Order is the semantics: within a scope the last match wins, so the denial has to come
    // after the allows or a name on both lists would stay on.
    const rules = agentPresetRules({ tools: ['read', 'write'], disallowedTools: ['write'] })
    expect(verdictIn(rules, 'tool:read')).toBe('allow')
    expect(verdictIn(rules, 'tool:write')).toBe('deny')
  })

  test('a negative list alone does not close the kind', () => {
    const rules = agentPresetRules({ disallowedTools: ['write'] })
    expect(verdictIn(rules, 'tool:write')).toBe('deny')
    expect(verdictIn(rules, 'tool:read')).toBe('allow')
  })

  test('skills and MCP close their own kinds, independently', () => {
    const rules = agentPresetRules({ pinnedSkills: ['review'], mcp_servers: ['grep'] })
    expect(verdictIn(rules, 'skill:review')).toBe('allow')
    expect(verdictIn(rules, 'skill:other')).toBe('deny')
    expect(verdictIn(rules, 'mcp:grep')).toBe('allow')
    expect(verdictIn(rules, 'mcp:github')).toBe('deny')
    // A kind the record says nothing about is untouched — tools here.
    expect(verdictIn(rules, 'tool:bash')).toBe('allow')
  })

  test('plugins are never seeded', () => {
    // A record has no field for them. Seeding one would be a decision nobody made.
    const rules = agentPresetRules({ tools: ['read'], pinnedSkills: [], mcp_servers: [] })
    expect(rules.some((rule) => rule.action.startsWith('plugin:'))).toBe(false)
  })

  test("an imported tool entry's arguments are not a capability", () => {
    // Claude Code writes `Bash(git status:*)`; the action is the TOOL, and arguments belong
    // in a rule's resource. Seeding the literal would allow a capability nobody has.
    const rules = agentPresetRules({ tools: ['Bash(git status:*)'] })
    expect(rules[1]?.action).toBe('tool:Bash')
  })

  test('every allow it emits names something the record asked for', () => {
    // A preset never allows a name the record did not list: the allows exist only to carve
    // exceptions out of the closing denial that precedes them.
    const record = { tools: ['read'], pinnedSkills: ['review'], mcp_servers: ['grep'] }
    const asked = new Set(['tool:read', 'skill:review', 'mcp:grep'])
    for (const rule of agentPresetRules(record)) {
      if (rule.effect === 'allow') expect(asked.has(rule.action)).toBe(true)
    }
  })

  test('a rule appended after the preset narrows it', () => {
    // The preset is a SEED, not a floor: it is the opening of the agent's own list, and the
    // rows the user adds after it decide, because the last match wins.
    const verdict = evaluate(
      [
        ...agentPresetRules({ tools: ['read'] }),
        { action: 'tool:read', resource: '*', effect: 'deny' },
      ],
      'tool:read',
      '*',
      'allow',
    )
    expect(verdict.effect).toBe('deny')
  })
})
