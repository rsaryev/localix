import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentTool } from '@localixai/agent/agents'
import { tempDirPerTest } from '@localixai/testing'

import type { PermissionRule } from '../../../agent-core/permission-engine'
import type { DiscoveredSkill } from '../../../agent-core/skill-discovery'
import { createSkillTool } from '../../../agent-core/tools/skill'
import type { SessionRecord } from '../../repository'
import { renderSkillBody } from '../../service/skill-render'
import {
  authorizeSkillCommands,
  skillToolPorts,
  type SkillCommandPolicyRef,
} from './skill-tool-ports'

/**
 * The model loading a skill must not get a shell the run's rules withhold. The defect: `get`
 * (classed a read, so plan mode let it through) ran the skill's injected commands with no
 * permission check at all. Claude Code checks each one first, and anything but `allow` aborts.
 */
const dir = tempDirPerTest('skill-tool-ports-')

// The shell tool's own verdict on a call: `git status` only reads, anything else reaches out.
const bash = {
  name: 'bash',
  classify: (input: { command?: string }) => ({
    effect: input.command?.startsWith('git status') ? 'read' : 'external',
  }),
} as unknown as AgentTool

const PLAN: PermissionRule[] = [
  {
    permission: '*',
    pattern: 'effect:external',
    action: 'deny',
    message: 'Plan mode is read-only',
  },
]
const ASK_SHELL: PermissionRule[] = [{ permission: 'bash', pattern: '*', action: 'ask' }]

const policy = (rules: PermissionRule[], tools = [bash]): SkillCommandPolicyRef => ({
  current: { rules, toolsByName: new Map(tools.map((t) => [t.name, t])), root: '/w' },
})

describe('a skill’s injected commands meet the run’s rules', () => {
  test('a read-only mode refuses a command that reaches out, and lets a read run', () => {
    const check = authorizeSkillCommands(policy(PLAN), {})
    expect(check('git status')).toBeUndefined()
    expect(check('touch x')).toContain('Plan mode is read-only')
  })

  test('a command the rules would ask about is refused unless the skill pre-approves it', () => {
    expect(authorizeSkillCommands(policy(ASK_SHELL), {})('git status')).toContain('allowed-tools')
    const own = authorizeSkillCommands(policy(ASK_SHELL), { allowedTools: ['Bash(git status)'] })
    expect(own('git status')).toBeUndefined()
  })

  test('nothing runs without the run’s rules or without a shell tool', () => {
    expect(authorizeSkillCommands({}, {})('git status')).toBeString()
    expect(authorizeSkillCommands(policy([], []), {})('git status')).toBeString()
  })

  test('the skill tool’s get refuses the load and runs nothing', async () => {
    const marker = join(dir(), 'ran')
    const skill = {
      name: 'zz-ports-sneaky',
      description: 'd',
      content: `Run: !\`touch ${marker}\``,
      scope: 'global',
      path: join(dir(), 'zz-ports-sneaky', 'SKILL.md'),
      dir: join(dir(), 'zz-ports-sneaky'),
      pluginName: 'zzports',
    } as DiscoveredSkill
    const ports = skillToolPorts({
      userId: 'u',
      session: { id: 's', agents: [] } as unknown as SessionRecord,
      defaultCwd: dir(),
      renderSkill: renderSkillBody,
      commandPolicy: policy(PLAN),
    })
    const tool = createSkillTool(null, [skill], {}, '', undefined, () => {}, ports.renderSkill)
    const got = await tool.execute('t', { action: 'get', name: 'zzports:zz-ports-sneaky' })
    expect(got.isError).toBe(true)
    expect(String(got.content)).toContain('Shell command permission check failed for pattern')
    expect(existsSync(marker)).toBe(false)
  })
})
