import { describe, expect, test } from 'bun:test'

import { persistPermissionRule } from './availability'
import { builtinAgentPreset } from './builtin-agent-presets'
import { evaluate } from '../agent-core/permission-engine'
import { extractCallFacts } from '../agent-core/permission-facts'
import type { Rule } from './rule'

/** The repository reduced to the one call the writer makes, over an in-memory list. */
function memoryRules(initial: Rule[]) {
  let rules = initial
  return {
    repo: {
      mutate: async (_userId: string, _agentId: string, change: (current: Rule[]) => Rule[]) => {
        rules = change(rules)
      },
    } as never,
    read: () => rules,
  }
}

/** The stored rows as the engine evaluates them — the projection a run sees. */
const asEngine = (rules: Rule[]) =>
  rules.map((rule) => ({
    permission: rule.action.replace(/^tool:/u, ''),
    pattern: rule.resource,
    action: rule.effect,
  }))

describe('where an "Always" rule lands', () => {
  test('before the danger guard, so "Always for git" does not approve a force push', async () => {
    // Appended, `tool:bash git * allow` was the LAST match for `git push --force` — the
    // `dangerous ask` above it lost, and one click disarmed the one confirmation kept.
    const store = memoryRules(builtinAgentPreset('backend'))
    await persistPermissionRule(store.repo, 'u', 'a', { action: 'tool:bash', resource: 'git *' })

    const rules = asEngine(store.read().filter((rule) => rule.action.startsWith('tool:')))
    const verdict = (command: string) =>
      evaluate(
        rules,
        { name: 'bash', effect: 'external' },
        extractCallFacts('bash', { command }, '/w'),
      )
    expect(verdict('git push origin main').action).toBe('allow')
    expect(verdict('git push --force origin main').action).toBe('ask')
  })

  test('after the rule that raised the card, so it does silence that card', async () => {
    const store = memoryRules(builtinAgentPreset('backend'))
    await persistPermissionRule(store.repo, 'u', 'a', {
      action: 'tool:read',
      resource: '/elsewhere/src/*',
    })
    const rules = asEngine(store.read().filter((rule) => rule.action.startsWith('tool:')))
    const read = (file: string) =>
      evaluate(
        rules,
        { name: 'read', effect: 'read' },
        extractCallFacts('read', { path: file }, '/w'),
      )
    expect(read('/elsewhere/src/a.ts').action).toBe('allow')
    expect(read('/elsewhere/other.ts').action).toBe('ask')
  })

  test('re-approving the same rule replaces it instead of stacking a duplicate', async () => {
    const store = memoryRules([])
    const rule = { action: 'tool:bash', resource: 'git *' }
    await persistPermissionRule(store.repo, 'u', 'a', rule)
    await persistPermissionRule(store.repo, 'u', 'a', rule)
    expect(store.read()).toEqual([{ ...rule, effect: 'allow' }])
  })
})
