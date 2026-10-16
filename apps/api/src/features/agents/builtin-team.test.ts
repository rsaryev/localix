import { describe, expect, test } from 'bun:test'
import { BUILTIN_AGENTS } from './builtin'
import { BUILTIN_TEAM } from './builtin-team'
import {
  builtinAgentPreset,
  builtinAgentPresetFor,
  inheritedAgentPreset,
} from '../capabilities/builtin-agent-presets'
import { evaluate } from '../capabilities/rule'
import { exposureLevel, shapeDefaultTools } from '../agent-core/run-shape'

describe('Localix is the sole shipped preset', () => {
  test('the definition roster and hierarchy contain only Localix', () => {
    expect(BUILTIN_TEAM).toEqual(BUILTIN_AGENTS)
    expect(
      BUILTIN_TEAM.map(({ handle, leadershipPriority }) => ({ handle, leadershipPriority })),
    ).toEqual([{ handle: 'localix', leadershipPriority: 2 }])
  })
  test('retired specialists have no shipped policy or reset target', () => {
    for (const handle of [
      'pm',
      'architect',
      'lead',
      'backend',
      'frontend',
      'qa',
      'design',
      'devops',
      'not-a-role',
      'Not A Handle!',
    ]) {
      expect(builtinAgentPreset(handle)).toEqual([])
      expect(builtinAgentPresetFor(`builtin:${handle}`)).toBeNull()
    }
  })
  test('Localix keeps open tool candidates, confirmations and host admission', () => {
    const rules = builtinAgentPreset('localix')
    expect(
      rules
        .filter((rule) => rule.action.startsWith('tool:'))
        .map((rule) => `${rule.action} ${rule.resource} ${rule.effect}`),
    ).toEqual(['tool:* outside-workspace ask', 'tool:bash dangerous ask'])
    expect(builtinAgentPresetFor('builtin:localix')).toEqual(rules)
    for (const host of ['chat', 'delegation', 'automation', 'channel', 'verification'])
      expect(evaluate(rules, `invocation:${host}`, 'builtin:localix', 'deny').effect).toBe('allow')
    expect(shapeDefaultTools('chat')).toContain('agents')
    expect(exposureLevel('subagent', 'agents')).toBe('never')
    expect(exposureLevel('automation', 'agents')).toBe('never')
  })
  test('a manually created specialist inherits only Localix’s default policy', () => {
    const id = 'native:global:reviewer'
    const rules = inheritedAgentPreset(id)
    expect(evaluate(rules, 'invocation:chat', id, 'deny').effect).toBe('allow')
    expect(rules.some((rule) => rule.resource === 'builtin:localix')).toBe(false)
    expect(evaluate(rules, 'tool:agents', '*', 'allow').effect).toBe('allow')
  })
})
