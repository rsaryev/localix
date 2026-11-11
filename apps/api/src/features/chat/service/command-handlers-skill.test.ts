import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { installModelAliasResolver } from '../../agent-core/model-alias'
import { modelAliasResolver } from '../../plugins/kit/model-alias'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { PermissionRule } from '../../agent-core/permission-engine'
import { skillTestSession } from '../../plugins/kit/testing'
import { handleSkillCommand } from './command-handlers'
import { handleSkillsControlCommand } from './command-handlers-listings'
import type { CommandHandlerContext } from './command-handlers-context'
import type { SessionRecord } from '../repository'
import { sessionSkills } from '../../plugins/kit'

/** A skill written for a test; `pluginDir` is its plugin's folder. */
type Written = { readonly pluginDir?: string }
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

// A `model:` value is read as the app reads it, through the kit (`bootstrap/domain-services.ts`).
beforeAll(() => installModelAliasResolver(modelAliasResolver))
afterAll(() => installModelAliasResolver(undefined))

/**
 * A typed `/name` runs the skill as the chat's kit session expands it (skills.md); the kit says
 * which names are skills, and the handler turns the expansion into the turn.
 */
const dir = tempDirPerTest('typed-skill-')
const work = () => join(dir(), 'work')

const session: SessionRecord = sessionFixture({
  id: 's1',
  userId: 'u1',
  title: 'test',
  agent: routedAgent({ providerConnectionId: 'p1', modelId: 'gpt-4o', reasoningEffort: 'low' }),
  createdAt: 'now',
  updatedAt: 'now',
  lastMessageAt: 'now',
  rootSessionId: null,
})

/** A skill folder on disk and its row in Localix's list; `plugin` puts it in that plugin. */
function skill(name: string, frontmatter: string, body: string, plugin?: string): Written {
  const base = plugin ? join(dir(), 'plugins', plugin) : join(work(), '.claude')
  if (plugin) {
    mkdirSync(join(base, '.claude-plugin'), { recursive: true })
    writeFileSync(join(base, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: plugin }))
  }
  const at = join(base, 'skills', name)
  mkdirSync(at, { recursive: true })
  writeFileSync(
    join(at, 'SKILL.md'),
    `---\nname: ${name}\ndescription: d\n${frontmatter}\n---\n${body}\n`,
  )
  return plugin ? { pluginDir: base } : {}
}

function context(
  _own: Written[],
  plugins: Written[] = [],
  over: Partial<CommandHandlerContext> = {},
) {
  mkdirSync(join(work(), '.git'), { recursive: true })
  const runs: { instruction: string; opts: Record<string, unknown> }[] = []
  const forks: Record<string, unknown>[] = []
  const replies: string[] = []
  const pluginDirs = [...new Set(plugins.flatMap((one) => one.pluginDir ?? []))]
  const ctx = {
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => false, isRunning: () => false },
    now: () => 'now',
    loadSkillOverrides: async () => ({}),
    resolveSessionWorkingDir: async () => work(),
    chatPluginSession: () => skillTestSession(join(dir(), 'home'), work(), pluginDirs),
    runMacroCommand: async (...args: unknown[]) => {
      runs.push({ instruction: String(args[5]), opts: args[7] as Record<string, unknown> })
      return { sessionId: 's1', messageId: 'a1' }
    },
    spawnForkSkill: async (...args: unknown[]) => {
      forks.push(args[3] as Record<string, unknown>)
      return 'child-session'
    },
    insertDirectReply: async (...args: unknown[]) => {
      replies.push(String(args[3]))
      return { sessionId: 's1', messageId: 'r1' }
    },
    ...over,
  } as unknown as CommandHandlerContext
  return { ctx, runs, forks, replies }
}

const typed = (ctx: CommandHandlerContext, prompt: string) =>
  handleSkillCommand(ctx, 'u1', 's1', session, prompt)

describe('a typed skill', () => {
  test('runs one hidden instruction with its arguments, without pinning the session', async () => {
    const { ctx, runs } = context([skill('sample', '', 'Handle $ARGUMENTS carefully.')])
    expect(await typed(ctx, '/sample auth flow')).toEqual({ sessionId: 's1', messageId: 'a1' })
    expect(runs).toHaveLength(1)
    expect(runs[0]!.instruction).toContain('Handle auth flow carefully.')
    expect(runs[0]!.opts).toMatchObject({
      invocation: { invocation: { kind: 'skill', name: 'sample', arguments: 'auth flow' } },
    })
    expect(session.pinnedSkills).toEqual([])
  })

  test('a model-only skill is refused with the reason, and no run starts', async () => {
    const { ctx, runs, replies } = context([skill('helper', 'user-invocable: false', 'Help')])
    await typed(ctx, '/helper')
    expect(runs).toEqual([])
    expect(replies[0]).toStartWith('Skill `/helper`:')
  })

  test('an off skill is no skill: the final gate reports it', async () => {
    const { ctx } = context([skill('sample', '', 'x')], [], {
      loadSkillOverrides: async () => ({ sample: 'off' as const }),
    })
    expect(await typed(ctx, '/sample')).toBeNull()
  })

  // skills.md: `model` and `effort` apply "for the rest of the current turn".
  test('its model, effort and tool lists run the invoking turn', async () => {
    const { ctx, runs } = context([
      skill(
        'deep',
        'model: gpt-4o-mini\neffort: max\nallowed-tools: Bash(gh *)\ndisallowed-tools: Write',
        'Go.',
      ),
    ])
    await typed(ctx, '/deep')
    expect(runs[0]!.opts).toMatchObject({
      modelId: 'gpt-4o-mini',
      reasoningEffort: 'max',
      extraAllowedTools: ['Bash(gh *)'],
      extraDisabledTools: ['Write'],
    })
  })

  // skills.md: "Claude Code starts a new subagent of the type set in the `agent` field".
  test('context: fork runs the fork as the subagent type it names, with its hooks', async () => {
    const hooks = { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] }
    const forked = skill(
      'review',
      'context: fork\nagent: reviewer\nhooks:\n  PreToolUse:\n    - hooks:\n        - type: command\n          command: x',
      'Review.',
      'cc',
    )
    const { ctx, forks, runs } = context([], [forked])
    await typed(ctx, '/cc:review')
    expect(runs).toEqual([])
    expect(forks[0]).toMatchObject({
      agent: 'reviewer',
      hooks,
      hooksPlugin: { id: 'cc@test', name: 'cc' },
    })
  })

  // skills.md: "A failed command aborts the entire skill invocation".
  test('a failing injected command aborts it before the model is asked', async () => {
    const { ctx, runs, replies } = context([skill('fail', '', 'ABORT-BODY\n!`exit 3`')])
    await typed(ctx, '/fail')
    expect(runs).toEqual([])
    expect(replies[0]).not.toContain('ABORT-BODY')
  })

  test('stacked skills all load, each with the trailing arguments and its grants', async () => {
    const { ctx, runs } = context([
      skill('write-tests', 'allowed-tools: Bash(bun test *)', 'Write tests for $ARGUMENTS.'),
      skill('fix-issue', 'allowed-tools: Bash(gh *)', 'Fix issue $ARGUMENTS.'),
    ])
    await typed(ctx, '/write-tests /fix-issue 123')
    expect(runs[0]!.instruction).toContain('Write tests for 123.')
    expect(runs[0]!.instruction).toContain('Fix issue 123.')
    expect(runs[0]!.opts.extraAllowedTools).toEqual(['Bash(bun test *)', 'Bash(gh *)'])
  })
})

describe('plugin skills run as /<plugin>:<skill>', () => {
  test('by the namespaced name', async () => {
    const { ctx, runs } = context(
      [],
      [skill('review', '', 'Plugin kit handles $ARGUMENTS.', 'kit')],
    )
    await typed(ctx, '/kit:review the auth flow')
    expect(runs[0]!.instruction).toContain('Plugin kit handles the auth flow.')
  })

  // The kit's judgment: a plugin's folder skill is `<plugin>:<folder>` and has no bare name; only
  // a plugin's root SKILL.md answers bare (loading/readers-text.ts, host/session-skill-entries.ts).
  test('a folder skill answers only to the namespaced name', async () => {
    const { ctx, runs } = context([], [skill('lint', '', 'Lint.', 'kit')])
    expect(await typed(ctx, '/lint')).toBeNull()
    expect(runs).toEqual([])
  })

  test("the person's own skill keeps its bare name over a plugin's", async () => {
    const { ctx, runs } = context(
      [skill('sample', '', 'Own $ARGUMENTS.')],
      [skill('sample', '', 'Plugin $ARGUMENTS.', 'kit')],
    )
    await typed(ctx, '/sample x')
    expect(runs[0]!.instruction).toContain('Own x.')
  })
})

// skills.md, "Permission checks on injected commands": a command a deny rule matches aborts, and
// so does anything but allow unless the skill's `allowed-tools` pre-approve it.
describe('a typed skill’s injected commands meet the agent’s rules', () => {
  const RULES: PermissionRule[] = [
    { permission: 'Bash', pattern: '*', action: 'ask' },
    { permission: 'Bash', pattern: 'touch *', action: 'deny', message: 'no touching' },
  ]
  const rules = { loadSkillCommandRules: async () => RULES }

  test('a denied command aborts the skill and runs nothing', async () => {
    const marker = join(dir(), 'ran')
    const { ctx, runs } = context([skill('probe', '', `Go: !\`touch ${marker}\``)], [], rules)
    await typed(ctx, '/probe')
    expect(runs).toEqual([])
    expect(existsSync(marker)).toBe(false)
  })

  test('a command the rules would ask about runs once allowed-tools pre-approve it', async () => {
    const asked = context([skill('probe', '', 'Say: !`echo hi`')], [], rules)
    await typed(asked.ctx, '/probe')
    expect(asked.runs).toEqual([])
    const granted = context(
      [skill('probe', 'allowed-tools: Bash(echo *)', 'Say: !`echo hi`')],
      [],
      rules,
    )
    await typed(granted.ctx, '/probe')
    expect(granted.runs[0]!.instruction).toContain('Say: hi')
  })
})

describe('handleSkillsControlCommand', () => {
  test('does not reveal skills whose override is off', async () => {
    const replies: string[] = []
    skill('sample', '', 'x')
    skill('enabled', '', 'y')
    const kit = await skillTestSession(join(dir(), 'home'), work())
    await kit.reloadSkills({ signal: AbortSignal.timeout(10_000) })
    await handleSkillsControlCommand(
      {
        gatherSessionSkills: async () => sessionSkills(kit),
        loadSkillOverrides: async () => ({ sample: 'off' }),
      },
      'u1',
      session,
      async (reply) => {
        replies.push(reply)
        return { sessionId: 's1', messageId: 'a1' }
      },
    )
    expect(replies[0]).toContain('/enabled')
    expect(replies[0]).not.toContain('/sample')
  })
})
