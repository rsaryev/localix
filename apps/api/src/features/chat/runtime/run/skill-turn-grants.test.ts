import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import type { PermissionRule } from '../../../agent-core/permission-engine'
import { verdictOf } from '../../../agent-core/permission-verdict'
import type { DiscoveredSkill } from '../../../agent-core/skill-discovery'
import type { SessionRecord } from '../../repository'
import { skillToolPorts, type SkillCommandPolicyRef } from './skill-tool-ports'

// skills.md, frontmatter `allowed-tools`: "Tools Claude can use without asking permission during
// the turn that invokes this skill", and `disallowed-tools`: "Tools removed from Claude's
// available pool while this skill is active". Both hold when Claude itself invokes the skill.
const tool = (name: string) =>
  ({ name, classify: () => ({ effect: 'external' }) }) as unknown as AgentTool
const ASK: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]

const policy = (): SkillCommandPolicyRef => ({
  current: {
    rules: [...ASK],
    preapprovedRules: [],
    toolsByName: new Map(['bash', 'write', 'read'].map((n) => [n, tool(n)])),
    root: '/w',
  },
})

describe('a skill the model loads applies its tool lists to the turn', () => {
  test('allowed-tools are pre-approved and disallowed-tools refused for the rest of the run', () => {
    const commandPolicy = policy()
    const ports = skillToolPorts({
      userId: 'u',
      session: { id: 's', agents: [] } as unknown as SessionRecord,
      defaultCwd: '/w',
      commandPolicy,
    })
    const check = () => verdictOf(commandPolicy.current!)
    expect(check()('bash', { command: 'git push origin' }).decision).toBe('ask')
    ports.onSkillLoaded({
      name: 'ship',
      description: 'd',
      content: 'Ship it.',
      scope: 'project',
      path: '/w/.localix/skills/ship/SKILL.md',
      dir: '/w/.localix/skills/ship',
      allowedTools: ['Bash(git push *)'],
      disallowedTools: ['Write'],
    } as DiscoveredSkill)
    expect(check()('bash', { command: 'git push origin' }).decision).toBe('allow')
    expect(check()('bash', { command: 'rm -rf x' }).decision).toBe('ask')
    expect(check()('write', { path: 'a.txt', content: 'x' }).decision).toBe('deny')
  })
})
