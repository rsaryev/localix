import { describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { monitorsToLaunch } from './monitors'
import { invokeSkill } from './skills'
import { createChatPluginSessions } from './sessions'
import { diskPluginHost, writeTestPlugin } from './testing'

/**
 * What a chat's kit session hands the monitor host to spawn (plugins/components.md, "Monitors"):
 * its `always` monitors when it opens, an `on-skill-invoke` one after its skill ran, each once, and
 * the paths as environment values the command refers to, never pasted into it.
 */
const dir = tempDirPerTest('kit-monitors')
const signal = new AbortController().signal

async function chat() {
  const cwd = join(dir(), 'work')
  mkdirSync(join(cwd, '.git'), { recursive: true })
  const root = join(dir(), 'ops')
  const plugin = await writeTestPlugin(root, 'ops', {
    'skills/deploy/SKILL.md': '---\ndescription: Deploy\n---\nDeploy it.',
    'skills/notes/SKILL.md': '---\ndescription: Notes\n---\nNotes.',
    'monitors/monitors.json': JSON.stringify([
      { name: 'errors', command: 'tail -F "${CLAUDE_PLUGIN_ROOT}"/err.log', description: 'Errors' },
      {
        name: 'deploy-status',
        command: 'echo deploying',
        description: 'Deploy status',
        when: 'on-skill-invoke:deploy',
      },
      {
        name: 'secret',
        command: 'echo ${user_config.token}',
        description: 'Refused',
        when: 'on-skill-invoke:notes',
      },
    ]),
  })
  const session = createChatPluginSessions(diskPluginHost(join(dir(), 'home'))).forRun({
    chatId: 'chat-1',
    cwd,
    transcriptPath: join(dir(), 'chat-1.jsonl'),
    permissionMode: 'default',
    trusted: true,
    layers: [],
    plugins: [plugin],
  })
  return { session, cwd, root }
}

const names = (launched: { launches: readonly { name: string }[] }) =>
  launched.launches.map((one) => one.name)

describe("a chat session's monitors", () => {
  test('when it opens: the always ones, in its folder, the paths in the environment', async () => {
    const { session, cwd, root } = await chat()
    const { launches, problems } = await monitorsToLaunch(session)
    expect(problems).toEqual([])
    expect(launches).toHaveLength(1)
    const [errors] = launches
    expect(errors).toMatchObject({
      pluginId: 'ops@test',
      pluginName: 'ops',
      name: 'errors',
      description: 'Errors',
      command: 'tail -F "${CLAUDE_PLUGIN_ROOT}"/err.log',
      cwd,
    })
    expect(errors?.env.CLAUDE_PLUGIN_ROOT).toBe(root)
    expect(errors?.env.PATH).toBe(String(process.env.PATH))
    expect((await monitorsToLaunch(session)).launches).toEqual([])
  })

  test('a skill that ran starts the monitor waiting for it, the first time only', async () => {
    const { session } = await chat()
    await monitorsToLaunch(session)
    const ran = await invokeSkill(session, 'ops:deploy', { invoker: 'model', signal })
    expect(ran.ok).toBe(true)
    expect(names(await monitorsToLaunch(session))).toEqual(['deploy-status'])
    await invokeSkill(session, 'ops:deploy', { invoker: 'model', signal })
    expect(names(await monitorsToLaunch(session))).toEqual([])
  })

  test('a monitor that needs a user_config value is reported once and not started', async () => {
    const { session } = await chat()
    await monitorsToLaunch(session)
    await invokeSkill(session, 'ops:notes', { invoker: 'model', signal })
    const first = await monitorsToLaunch(session)
    expect(first.launches).toEqual([])
    expect(first.problems).toHaveLength(1)
    expect(first.problems[0]).toContain('Monitor "secret"')
    expect(await monitorsToLaunch(session)).toEqual({ launches: [], problems: [] })
  })
})
