import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { handleSkillCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import type { SkillRecord } from './skills'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

// skills.md, "Stack several skills in one message": "typing `/write-tests /fix-issue 123` loads
// both skills and passes the trailing text `123` as `$ARGUMENTS` to each of them"; up to five more
// after the first, and expansion stops at the first token that isn't an inline user-invocable skill.
const session = sessionFixture({
  id: 's1',
  userId: 'u1',
  agent: routedAgent({ providerConnectionId: 'p1', modelId: 'gpt-4o' }),
})
const skill = (name: string, content: string, extra: Partial<SkillRecord> = {}): SkillRecord => ({
  id: `file:${name}`,
  name,
  description: 'd',
  content,
  tags: [],
  projectId: '',
  scope: 'project',
  source: 'file',
  updatedAt: 'now',
  path: `${tmpdir()}/${name}/SKILL.md`,
  ...extra,
})

function context(skills: SkillRecord[]) {
  const runs: Array<{ instruction: string; opts: Record<string, unknown> }> = []
  const ctx = {
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => false, isRunning: () => false },
    now: () => 'now',
    gatherSessionSkills: async () => skills,
    gatherEnabledPluginSkills: async () => [],
    loadSkillOverrides: async () => ({}),
    resolveSessionWorkingDir: async () => tmpdir(),
    runMacroCommand: async (...args: unknown[]) => {
      runs.push({ instruction: String(args[5]), opts: args[7] as Record<string, unknown> })
      return { sessionId: 's1', messageId: 'a1' }
    },
    insertDirectReply: async () => ({ sessionId: 's1', messageId: 'r1' }),
  } as unknown as CommandHandlerContext
  return { ctx, runs }
}

test('stacked skills all load, each with the trailing arguments', async () => {
  const { ctx, runs } = context([
    skill('write-tests', 'Write tests for $ARGUMENTS.', { allowedTools: ['Bash(bun test *)'] }),
    skill('fix-issue', 'Fix issue $ARGUMENTS.', { allowedTools: ['Bash(gh *)'] }),
    skill('forked', 'Fork me.', { contextFork: true }),
  ])
  await handleSkillCommand(ctx, 'u1', 's1', session, '/write-tests /fix-issue 123')
  expect(runs).toHaveLength(1)
  expect(runs[0]!.instruction).toContain('Write tests for 123.')
  expect(runs[0]!.instruction).toContain('Fix issue 123.')
  expect(runs[0]!.opts.extraAllowedTools).toEqual(['Bash(bun test *)', 'Bash(gh *)'])

  // A forked skill ends the stack: it and what follows are the arguments.
  const stop = context([
    skill('one', 'One: $ARGUMENTS'),
    skill('forked', 'Fork me.', { contextFork: true }),
  ])
  await handleSkillCommand(stop.ctx, 'u1', 's1', session, '/one /forked x')
  expect(stop.runs[0]!.instruction).toContain('One: /forked x')
})
