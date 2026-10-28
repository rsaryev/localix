import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/agent/agents'

import { evaluate, extractCallFacts } from '../agent-core/permission-engine'
import { skillPermissionRules } from '../chat/runtime/run/permission-gate-build'
import { builtinAgentPreset } from './builtin-agent-presets'
import { applyPermissionMode } from './permission-mode-policy'
import { PERMISSION_MODES, type PermissionMode } from '../../contracts/permission-modes'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from './resolve'
import type { Rule } from '../agent-core/capability-rule'

const ROOT = '/tmp/workspace'
const ROSTER = { ...NO_ROSTERS, tool: ['bash', 'write', 'read', 'board', 'ask', 'plan'] }

/** The real path a run takes: rewrite, compose, project, then (optionally) the skill fold. */
function runRules(mode: PermissionMode, rules: readonly Rule[], skillAllows?: string[]) {
  const policy = applyPermissionMode(mode, rules)
  const projection = projectCapabilities(composeCapabilities(policy.rules), ROSTER)
  return {
    policy,
    denied: projection.denied.tool,
    permissions: projection.permissions,
    grants: skillPermissionRules(skillAllows),
  }
}

const verdict = (
  permissions: ReturnType<typeof runRules>['permissions'],
  name: string,
  callClass: CallClass,
  input: unknown = {},
  grants: ReturnType<typeof skillPermissionRules> = [],
) =>
  evaluate(permissions, { name, ...callClass }, extractCallFacts(name, input, ROOT), grants).action

const PRESET = builtinAgentPreset('localix')
const ASKING: Rule[] = [...PRESET, { action: 'tool:Bash', resource: 'git push*', effect: 'ask' }]

describe('session permission modes rewrite the rules and nothing else', () => {
  test.each([...PERMISSION_MODES])('%s never weakens a denial the agent wrote', (mode) => {
    const rules: Rule[] = [
      ...PRESET,
      { action: 'tool:Bash', resource: 'npm publish*', effect: 'deny' },
    ]
    const { permissions } = runRules(mode, rules)
    expect(
      verdict(permissions, 'Bash', { effect: 'external' }, { command: 'npm publish --tag x' }),
    ).toBe('deny')
  })

  test.each([...PERMISSION_MODES])('%s keeps the agent rows in their order', (mode) => {
    const { policy } = runRules(mode, PRESET)
    // A mode that stops asking drops the preset's two CLASS questions (`stopAsking`); every
    // other row stays where it was.
    const stopsAsking = mode === 'bypass' || mode === 'autonomous'
    const expected = PRESET.filter((rule) => !(stopsAsking && rule.effect === 'ask'))
    const kept = policy.rules.slice(0, expected.length)
    expect(kept.map((rule) => [rule.action, rule.resource])).toEqual(
      expected.map((rule) => [rule.action, rule.resource]),
    )
  })

  test.each([...PERMISSION_MODES])('%s is idempotent in effect', (mode) => {
    const once = runRules(mode, ASKING).permissions
    const twice = runRules(mode, applyPermissionMode(mode, ASKING).rules).permissions
    for (const [name, callClass, input] of [
      ['Bash', { effect: 'external' }, { command: 'git push origin' }],
      ['Write', { effect: 'files' }, { path: `${ROOT}/a.ts` }],
      ['Read', { effect: 'read' }, { path: '/etc/hosts' }],
      ['ask', { effect: 'read', needsHuman: true }, {}],
    ] as const) {
      expect(verdict(twice, name, callClass, input)).toBe(verdict(once, name, callClass, input))
    }
  })

  test('default changes no answer the agent rules give', () => {
    const { permissions, denied } = runRules('default', ASKING)
    expect(verdict(permissions, 'Bash', { effect: 'external' }, { command: 'git push' })).toBe(
      'ask',
    )
    expect(denied).toEqual([])
  })
})

describe('plan', () => {
  const { permissions, denied } = runRules('plan', PRESET)

  test('refuses every call that reaches past the conversation', () => {
    expect(verdict(permissions, 'Write', { effect: 'files' }, { path: `${ROOT}/a.ts` })).toBe(
      'deny',
    )
    expect(verdict(permissions, 'Bash', { effect: 'external' }, { command: 'make' })).toBe('deny')
    expect(verdict(permissions, 'board', { effect: 'host' })).toBe('deny')
  })

  test('lets reads, views and the conversation own state through', () => {
    expect(verdict(permissions, 'Bash', { effect: 'read' }, { command: 'ls' })).toBe('allow')
    expect(verdict(permissions, 'board', { effect: 'session' })).toBe('allow')
    expect(verdict(permissions, 'Read', { effect: 'view' })).toBe('allow')
  })

  test('does not silence the baseline question about paths outside the workspace', () => {
    expect(verdict(permissions, 'Read', { effect: 'read' }, { path: '/etc/hosts' })).toBe('ask')
  })

  test('no mode removes the plan tool: after an approval the implementing run completes it', () => {
    expect(denied).not.toContain('Plan')
    for (const mode of PERMISSION_MODES) expect(runRules(mode, PRESET).denied).not.toContain('Plan')
  })

  test('a skill allow-list cannot lift a plan denial', () => {
    const { permissions, grants } = runRules('plan', PRESET, ['Bash(make *)'])
    expect(
      verdict(permissions, 'Bash', { effect: 'external' }, { command: 'make build' }, grants),
    ).toBe('deny')
  })
})

describe('bypass and autonomous', () => {
  test.each(['bypass', 'autonomous'] as const)(
    '%s turns every tool question into allow',
    (mode) => {
      const { permissions } = runRules(mode, ASKING)
      expect(verdict(permissions, 'Bash', { effect: 'external' }, { command: 'git push' })).toBe(
        'allow',
      )
      expect(verdict(permissions, 'Read', { effect: 'read' }, { path: '/etc/hosts' })).toBe('allow')
    },
  )

  test.each(['bypass', 'autonomous'] as const)('%s still refuses catastrophic commands', (mode) => {
    const { permissions } = runRules(mode, ASKING)
    expect(verdict(permissions, 'Bash', { effect: 'external' }, { command: 'rm -rf ~' })).toBe(
      'deny',
    )
  })

  test('bypass keeps a person reachable; autonomous does not, and refuses what waits on one', () => {
    expect(applyPermissionMode('bypass', ASKING).humanReachable).toBe(true)
    const autonomous = runRules('autonomous', ASKING)
    expect(autonomous.policy.humanReachable).toBe(false)
    expect(verdict(autonomous.permissions, 'ask', { effect: 'read', needsHuman: true })).toBe(
      'deny',
    )
    expect(
      verdict(runRules('bypass', ASKING).permissions, 'ask', { effect: 'read', needsHuman: true }),
    ).toBe('allow')
  })

  test('rules about plugins and agents are not questions about a call and stay asks', () => {
    const rules: Rule[] = [{ action: 'plugin:office', resource: '*', effect: 'ask' }]
    expect(applyPermissionMode('bypass', rules).rules[0]?.effect).toBe('ask')
  })
})
