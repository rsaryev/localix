import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { handleSkillCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import { renderPluginPrompt } from './plugin-commands'
import { expandSkillContent, SKILL_SHELL_DISABLED_NOTICE } from './skill-commands'
import { renderSkillBody, withSkillShellPolicy } from './skill-render'
import type { SkillRecord } from './skills'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

// skills.md, "Inject dynamic context": with `disableSkillShellExecution`, "each command is replaced
// with `[shell command execution disabled by policy]` instead of being run" — inline `!` commands
// and ```! blocks alike; bundled and managed skills are not affected.
const PLACEHOLDER = '[shell command execution disabled by policy]'
const dir = tempDirPerTest('skill-shell-policy-')

describe('the placeholder', () => {
  test('is the text the docs name', () => {
    expect(SKILL_SHELL_DISABLED_NOTICE).toBe(PLACEHOLDER)
  })

  test('replaces an inline command and a fenced block, and runs neither', async () => {
    const marker = join(dir(), 'ran')
    const content = [
      `Branch: !\`touch ${marker}\``,
      '```!',
      `touch ${marker}`,
      'echo second',
      '```',
      'after',
    ].join('\n')
    const out = await expandSkillContent(content, dir(), {}, undefined, undefined, undefined, true)
    expect(out).toBe(`Branch: ${PLACEHOLDER}\n${PLACEHOLDER}\nafter`)
    expect(existsSync(marker)).toBe(false)
  })

  test('is not asked of the permission rules: nothing runs, so nothing can be denied', async () => {
    const asked: string[] = []
    const out = await expandSkillContent(
      'Go: !`rm -rf x`',
      dir(),
      {},
      undefined,
      (command) => (asked.push(command), 'denied'),
      undefined,
      true,
    )
    expect(out).toBe(`Go: ${PLACEHOLDER}`)
    expect(asked).toEqual([])
  })

  test('does not touch text that is not a command', async () => {
    const out = await expandSkillContent(
      'Say hi! `code` and !not',
      dir(),
      {},
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(out).toBe('Say hi! `code` and !not')
  })
})

describe('a skill and a plugin command rendered under the policy', () => {
  const ctx = () => ({ sessionId: 's1', workingDir: dir(), effort: 'low', dynamic: true })

  test('a skill shows the placeholder to the model and keeps filling its arguments', async () => {
    const marker = join(dir(), 'ran')
    const body = await renderSkillBody({ content: `Target $0: !\`touch ${marker}\`` }, 'prod', {
      ...ctx(),
      shellDisabled: true,
    })
    expect(body).toBe(`Target prod: ${PLACEHOLDER}`)
    expect(existsSync(marker)).toBe(false)
  })

  test('a plugin command does the same', async () => {
    const marker = join(dir(), 'ran2')
    const out = await renderPluginPrompt(`Run: !\`touch ${marker}\``, {}, '', {
      cwd: dir(),
      shellDisabled: true,
    })
    expect(out).toBe(`Run: ${PLACEHOLDER}`)
    expect(existsSync(marker)).toBe(false)
  })

  test('without the policy the same skill runs its command', async () => {
    const body = await renderSkillBody({ content: 'Say: !`echo hi`' }, '', ctx())
    expect(body).toBe('Say: hi')
  })
})

describe('the model’s skill tool', () => {
  test('asks the policy for the skill’s own folder and renders with its answer', async () => {
    const asked: unknown[] = []
    const rendered: boolean[] = []
    const render = withSkillShellPolicy(
      async (_skill, _args, c) => (rendered.push(c.shellDisabled === true), 'ok'),
      async (query) => (asked.push(query), true),
    )
    await render({ content: 'x', path: '/p/skill/SKILL.md' }, '', {
      sessionId: 's',
      workingDir: '/w',
      effort: 'low',
      dynamic: true,
    })
    expect(asked).toEqual([{ workingDir: '/w', skillPath: '/p/skill/SKILL.md' }])
    expect(rendered).toEqual([true])
  })

  test('with no policy the render is the one given', () => {
    const base = async () => 'x'
    expect(withSkillShellPolicy(base, undefined)).toBe(base)
  })
})

describe('a typed skill', () => {
  const session = sessionFixture({
    id: 's1',
    userId: 'u1',
    agent: routedAgent({ providerConnectionId: 'p1', modelId: 'gpt-4o' }),
  })

  function context(content: string, disabled: boolean, rules = true) {
    const runs: unknown[] = []
    const queried: unknown[] = []
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
    }
    const ctx = {
      repo: { listMessages: async () => [] },
      runner: { isBusy: () => false, isRunning: () => false },
      now: () => 'now',
      gatherSessionSkills: async () => [skill],
      gatherEnabledPluginSkills: async () => [],
      loadSkillOverrides: async () => ({}),
      // Rules that would abort the command: with the policy on it must never be asked.
      ...(rules
        ? {
            loadSkillCommandRules: async () => [
              { permission: 'Bash', pattern: '*', action: 'deny', message: 'no' },
            ],
          }
        : {}),
      skillShellDisabled: async (query: unknown) => (queried.push(query), disabled),
      resolveSessionWorkingDir: async () => dir(),
      runMacroCommand: async (...args: unknown[]) => (
        runs.push(args[5]),
        { sessionId: 's1', messageId: 'a1' }
      ),
      insertDirectReply: async () => ({ sessionId: 's1', messageId: 'r1' }),
    } as unknown as CommandHandlerContext
    return { ctx, runs, queried }
  }

  test('reaches the model with the placeholder when the policy is on', async () => {
    const marker = join(dir(), 'ran3')
    const { ctx, runs, queried } = context(`Go: !\`touch ${marker}\``, true)
    await handleSkillCommand(ctx, 'u1', 's1', session, '/probe')
    expect(String(runs[0])).toContain(`Go: ${PLACEHOLDER}`)
    expect(existsSync(marker)).toBe(false)
    expect(queried).toEqual([{ workingDir: dir(), skillPath: join(dir(), 'probe', 'SKILL.md') }])
  })

  test('runs its command when the policy is off', async () => {
    const { ctx, runs } = context('Say: !`echo hi`', false, false)
    await handleSkillCommand(ctx, 'u1', 's1', session, '/probe')
    expect(String(runs[0])).toContain('Say: hi')
  })
})
