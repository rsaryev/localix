import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { PermissionRule } from '../../agent-core/permission-engine'
import { TOOL } from '../../agent-core/tool-names'
import { createChatPluginSessions } from '../../plugins/kit/sessions'
import { diskPluginHost, testScopePlugin } from '../../plugins/kit/testing'
import { savedWorkflows } from '../../plugins/kit'
import { handlePluginCommand, handleSkillCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import type { SessionRecord } from '../repository'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

/**
 * A typed command runs as Claude Code runs it, a skill of the chat's kit session: a plugin's
 * `commands/*.md` as `/<plugin>:<name>` (claimed before the mods' commands), a folder's
 * `.claude/commands/*.md` as `/<name>`. Their `!` commands meet the agent's rules, their arguments
 * reach a shell as data, a sensitive option stays masked, and the files their `@` names are
 * attached from inside the working folder only.
 */
const dir = tempDirPerTest('typed-command-')
const work = () => join(dir(), 'work')
const pluginDir = () => join(dir(), 'plugins', 'ops')

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

/** The `ops` plugin with a `token` option the manifest marks sensitive, and the files given. */
function plugin(files: Record<string, string>) {
  const root = pluginDir()
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'ops',
      userConfig: {
        region: { type: 'string', title: 'Region', description: 'Region' },
        token: { type: 'string', title: 'Token', description: 'Token', sensitive: true },
      },
    }),
  )
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

const command = (frontmatter: string, body: string) =>
  `---\ndescription: d\n${frontmatter}\n---\n${body}\n`

type Layers = Parameters<ReturnType<typeof createChatPluginSessions>['forRun']>[0]['layers']

async function kitSession(withPlugin: boolean, layers: Layers) {
  const plugins = withPlugin
    ? [{ ...(await testScopePlugin(pluginDir())), values: { region: 'eu', token: 's3cr3t' } }]
    : []
  return createChatPluginSessions(diskPluginHost(join(dir(), 'home'))).forRun({
    chatId: 'chat-1',
    cwd: work(),
    transcriptPath: join(dir(), 'home', 'chat-1.jsonl'),
    permissionMode: 'default',
    trusted: true,
    layers,
    plugins,
  })
}

const RULES: PermissionRule[] = [
  { permission: 'Bash', pattern: '*', action: 'ask' },
  { permission: 'Bash', pattern: 'echo *', action: 'allow' },
]

function context(
  over: Partial<CommandHandlerContext> = {},
  withPlugin = true,
  layers: Layers = [],
) {
  mkdirSync(join(work(), '.git'), { recursive: true })
  const runs: { instruction: string; opts: Record<string, unknown> }[] = []
  const replies: string[] = []
  const activated: string[][] = []
  const kit = kitSession(withPlugin, layers)
  const ctx = {
    repo: {
      listMessages: async () => [],
      changeActivatedTools: async (
        _u: string,
        _s: string,
        change: (now: string[]) => { next: string[] } | null,
      ) => {
        const changed = change([])
        if (changed) activated.push(changed.next)
        return changed
      },
    },
    now: () => 'now',
    loadSkillOverrides: async () => ({}),
    loadSkillCommandRules: async () => RULES,
    resolveSessionWorkingDir: async () => work(),
    enabledWorkflows: () => savedWorkflows({ cwd: work(), homeDir: join(dir(), 'home') }),
    chatPluginSession: () => kit,
    runMacroCommand: async (...args: unknown[]) => {
      runs.push({ instruction: String(args[5]), opts: args[7] as Record<string, unknown> })
      return { sessionId: 's1', messageId: 'a1' }
    },
    insertDirectReply: async (...args: unknown[]) => {
      replies.push(String(args[3]))
      return { sessionId: 's1', messageId: 'r1' }
    },
    ...over,
  } as unknown as CommandHandlerContext
  return { ctx, runs, replies, activated }
}

const typed = (ctx: CommandHandlerContext, prompt: string) =>
  handlePluginCommand(ctx, 'u1', 's1', session, prompt)

describe('a typed plugin command', () => {
  test('reaches the model expanded, as a plugin command of its plugin', async () => {
    plugin({
      'commands/deploy.md': command(
        'argument-hint: <env>',
        'Deploy $0 from ${CLAUDE_PLUGIN_ROOT} in ${user_config.region}.',
      ),
    })
    const { ctx, runs } = context()
    expect(await typed(ctx, '/ops:deploy prod')).toEqual({ sessionId: 's1', messageId: 'a1' })
    expect(runs[0]!.instruction).toBe(`Deploy prod from ${pluginDir()} in eu.\n`)
    expect(runs[0]!.opts).toMatchObject({
      invocation: {
        source: 'plugin',
        invocation: { kind: 'plugin-command', name: 'ops:deploy', arguments: 'prod' },
        presentation: { label: '/ops:deploy', token: '/ops:deploy' },
      },
    })
  })

  test('its allowed-tools, paths filled, are granted for the turn; its disallowed-tools removed', async () => {
    plugin({
      'commands/run.md': command(
        'allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/run.sh *)\ndisallowed-tools: Write',
        'Run it.',
      ),
    })
    const { ctx, runs } = context()
    await typed(ctx, '/ops:run')
    expect(runs[0]!.opts).toMatchObject({
      extraAllowedTools: [`Bash(${pluginDir()}/run.sh *)`],
      extraDisabledTools: ['Write'],
    })
  })

  test('a sensitive option never reaches the model', async () => {
    plugin({ 'commands/auth.md': command('', 'Use ${user_config.token}.') })
    const { ctx, runs } = context()
    await typed(ctx, '/ops:auth')
    expect(runs[0]!.instruction).not.toContain('s3cr3t')
    expect(runs[0]!.instruction).toContain("sensitive option 'token'")
  })

  test("its `!` commands meet the agent's rules: one they would ask about aborts it", async () => {
    plugin({
      'commands/status.md': command('', 'STATUS-BODY !`ls`'),
      'commands/hello.md': command('', 'Said: !`echo hi`'),
    })
    const asked = context()
    await typed(asked.ctx, '/ops:status')
    expect(asked.runs).toEqual([])
    expect(asked.replies[0]).toContain('Shell command permission check failed for pattern "!`ls`"')
    expect(asked.replies[0]).not.toContain('STATUS-BODY')
    const allowed = context()
    await typed(allowed.ctx, '/ops:hello')
    expect(allowed.runs[0]!.instruction).toContain('Said: hi')
  })

  test('`disableSkillShellExecution` puts the placeholder where its `!` commands were', async () => {
    plugin({ 'commands/hello.md': command('', 'Said: !`echo hi`') })
    const disabled = [{ scope: 'user' as const, settings: { disableSkillShellExecution: true } }]
    const { ctx, runs } = context({}, true, disabled)
    await typed(ctx, '/ops:hello')
    expect(runs[0]!.instruction).toBe('Said: [shell command execution disabled by policy]\n')
  })

  test('an argument reaches its `!` command as data, and the rules read it quoted', async () => {
    plugin({
      'commands/say.md': command('', 'Said: !`echo $ARGUMENTS`'),
      'commands/shout.md': command('allowed-tools: Bash', 'Said: !`echo $ARGUMENTS`'),
    })
    // The command's own grant runs it: the argument is printed, not parsed.
    const granted = context()
    await typed(granted.ctx, '/ops:shout x $(touch PWNED)')
    expect(granted.runs[0]!.instruction).toContain('Said: x $(touch PWNED)')
    expect(existsSync(join(work(), 'PWNED'))).toBe(false)
    // The agent's `echo *` rule reads `echo x '$(touch' 'PWNED)'`, shell syntax in it: asked.
    const checked = context()
    await typed(checked.ctx, '/ops:say x $(touch PWNED)')
    expect(checked.replies[0]).toContain('Shell command permission check failed')
  })

  test('the files its `@` names are attached from inside the working folder only', async () => {
    plugin({ 'commands/read.md': command('', 'See @notes.md, @../outside.txt and @/etc/hosts.') })
    const { ctx, runs } = context()
    mkdirSync(work(), { recursive: true })
    writeFileSync(join(work(), 'notes.md'), 'NOTES-BODY')
    writeFileSync(join(dir(), 'outside.txt'), 'OUTSIDE-BODY')
    await typed(ctx, '/ops:read')
    expect(runs[0]!.instruction).toStartWith('See @notes.md, @../outside.txt and @/etc/hosts.')
    expect(runs[0]!.instruction).toContain('``` notes.md\nNOTES-BODY\n```')
    expect(runs[0]!.instruction).not.toContain('OUTSIDE-BODY')
    expect(runs[0]!.instruction).not.toContain('localhost')
  })

  // Claude Code 2.1.319 (the kit's oracle): a plugin's command wins its plugin's skill of one name.
  test('wins a skill of its plugin by the same name', async () => {
    plugin({
      'commands/check.md': command('', 'COMMAND-BODY'),
      'skills/check/SKILL.md': '---\nname: check\ndescription: d\n---\nSKILL-BODY\n',
    })
    const { ctx, runs } = context()
    await typed(ctx, '/ops:check')
    expect(runs[0]!.instruction).toContain('COMMAND-BODY')
  })

  test("a plugin's skill is left for the skill handler, after the mods' commands", async () => {
    plugin({ 'skills/lint/SKILL.md': '---\nname: lint\ndescription: d\n---\nLINT\n' })
    const { ctx, runs } = context()
    expect(await typed(ctx, '/ops:lint')).toBeNull()
    expect(runs).toEqual([])
  })
})

describe("a folder's command", () => {
  test('runs as a skill of the folder by its bare name', async () => {
    mkdirSync(join(work(), '.claude', 'commands'), { recursive: true })
    writeFileSync(join(work(), '.claude', 'commands', 'greet.md'), command('', 'Hi $ARGUMENTS.'))
    const { ctx, runs } = context({}, false)
    expect(await typed(ctx, '/greet you')).toBeNull()
    await handleSkillCommand(ctx, 'u1', 's1', session, '/greet you')
    expect(runs[0]!.instruction).toBe('Hi you.\n')
    expect(runs[0]!.opts).toMatchObject({
      invocation: { source: 'slash', invocation: { kind: 'skill', name: 'greet' } },
    })
  })
})

describe('a saved workflow', () => {
  const workflow = (name: string) => {
    mkdirSync(join(work(), '.claude', 'workflows'), { recursive: true })
    writeFileSync(
      join(work(), '.claude', 'workflows', `${name}.js`),
      `export const meta = { name: '${name}', description: 'Ships it' }\nreturn 1\n`,
    )
  }

  test('asks the agent to run it with the Workflow tool, which it activates', async () => {
    workflow('ship')
    const { ctx, runs, activated } = context({}, false)
    await typed(ctx, '/ship the release')
    expect(activated).toEqual([[TOOL.Workflow]])
    expect(runs[0]!.instruction).toContain('Run the workflow `ship` now')
    expect(runs[0]!.instruction).toEndWith('Input: the release')
    expect(runs[0]!.opts).toMatchObject({
      invocation: {
        invocation: { kind: 'plugin-command', name: 'ship', arguments: 'the release' },
      },
    })
  })

  test('a skill of the same name is what runs', async () => {
    workflow('ship')
    mkdirSync(join(work(), '.claude', 'skills', 'ship'), { recursive: true })
    writeFileSync(
      join(work(), '.claude', 'skills', 'ship', 'SKILL.md'),
      '---\nname: ship\ndescription: d\n---\nSKILL\n',
    )
    const { ctx, runs } = context({}, false)
    expect(await typed(ctx, '/ship')).toBeNull()
    expect(runs).toEqual([])
  })
})
