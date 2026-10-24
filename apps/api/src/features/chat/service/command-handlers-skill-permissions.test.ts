import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { PermissionRule } from '../../agent-core/permission-engine'
import { handleSkillCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import { renderPluginPrompt } from './plugin-commands'
import type { SkillRecord } from './skills'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { noLeadership } from '../runtime/conversation-strategy'

// skills.md, "Permission checks on injected commands": "Claude Code checks each one against your
// permission rules first. A command a deny rule matches aborts the invocation … when a command's
// permission check returns anything other than allow, Claude Code aborts", unless the skill's
// `allowed-tools` pre-approve it — whoever typed the skill.
const dir = tempDirPerTest('skill-perm-')
const session = sessionFixture({
  id: 's1',
  userId: 'u1',
  agents: routedParticipants({ providerConnectionId: 'p1', modelId: 'gpt-4o' }),
})
const RULES: PermissionRule[] = [
  { permission: 'bash', pattern: '*', action: 'ask' },
  { permission: 'bash', pattern: 'touch *', action: 'deny', message: 'no touching' },
]

function context(content: string, allowedTools?: string[]) {
  const runs: unknown[] = []
  const replies: string[] = []
  const skill: SkillRecord = {
    id: 'file:x',
    name: 'probe',
    description: 'd',
    content,
    tags: [],
    projectId: '',
    scope: 'project',
    source: 'file',
    updatedAt: 'now',
    path: join(dir(), 'probe', 'SKILL.md'),
    ...(allowedTools ? { allowedTools } : {}),
  }
  const ctx = {
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => false, isRunning: () => false, leadership: () => noLeadership },
    now: () => 'now',
    gatherSessionSkills: async () => [skill],
    gatherEnabledPluginSkills: async () => [],
    loadSkillOverrides: async () => ({}),
    loadSkillCommandRules: async () => RULES,
    resolveSessionWorkingDir: async () => dir(),
    runMacroCommand: async (...args: unknown[]) => (
      runs.push(args[5]),
      { sessionId: 's1', messageId: 'a1' }
    ),
    insertDirectReply: async (...args: unknown[]) => (
      replies.push(String(args[3])),
      { sessionId: 's1', messageId: 'r1' }
    ),
  } as unknown as CommandHandlerContext
  return { ctx, runs, replies }
}

describe('a typed skill’s injected commands meet the permission rules', () => {
  test('a denied command aborts the skill and runs nothing', async () => {
    const marker = join(dir(), 'ran')
    const { ctx, runs, replies } = context(`Go: !\`touch ${marker}\``)
    await handleSkillCommand(ctx, 'u1', 's1', session, '/probe')
    expect(runs).toEqual([])
    expect(replies[0]).toContain('Shell command permission check failed')
    expect(existsSync(marker)).toBe(false)
  })

  test('a command the rules would ask about runs once allowed-tools pre-approve it', async () => {
    const asked = context('Say: !`echo hi`')
    await handleSkillCommand(asked.ctx, 'u1', 's1', session, '/probe')
    expect(asked.runs).toEqual([])
    expect(asked.replies[0]).toContain('allowed-tools')

    const granted = context('Say: !`echo hi`', ['Bash(echo *)'])
    await handleSkillCommand(granted.ctx, 'u1', 's1', session, '/probe')
    expect(String(granted.runs[0])).toContain('Say: hi')
  })

  test('a plugin command is checked the same way', async () => {
    await expect(
      renderPluginPrompt('Go: !`touch x`', {}, '', {
        cwd: dir(),
        authorize: (command) => (command.startsWith('touch') ? 'denied (no touching)' : undefined),
      }),
    ).rejects.toThrow('Shell command permission check failed')
  })
})
