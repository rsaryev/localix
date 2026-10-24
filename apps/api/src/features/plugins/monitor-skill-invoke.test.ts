import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import type { AvailabilityReader } from '../capabilities/availability'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'
import { announceSkillInvoked, setSkillInvocationListener } from '../agent-core/skill-invocations'
import { createSkillTool } from '../agent-core/tools/skill'
import type { DiscoveredSkill } from '../agent-core/skill-discovery'
import {
  createPluginMonitorHost,
  type MonitorNotification,
  type MonitorSpawner,
} from './monitor-host'
import { monitorWaitsForSkill } from './monitor-skill-trigger'

/**
 * Claude Code starts an `on-skill-invoke:<skill>` monitor the first time that skill runs in the
 * session, and its lines reach that session. Localix used to parse such a monitor and never start
 * it.
 */
const home = tempDirPerTest('monitor-skill-invoke-')
const ON: AvailabilityReader = { effectFor: () => 'allow' }

function repo(names: string[]): CapabilitySourceRepository {
  const rows = names.map((name): CapabilitySourceRecord => ({
    id: name,
    userId: 'u1',
    projectId: '',
    name,
    config: {},
    source: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  return {
    listForScope: async () => rows,
    get: async (_u, _p, name) => rows.find((row) => row.name === name) ?? null,
    upsert: async () => rows[0]!,
    patchConfig: async () => rows[0]!,
    remove: async () => {},
  }
}

async function writePlugin(name: string, monitors: unknown[]): Promise<void> {
  const dir = join(home(), '.localix', 'plugins', name, '.claude-plugin')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'plugin.json'), JSON.stringify({ name, monitors }))
}

/** Each spawn prints one line naming its command, and stays open until killed. */
function spawner(spawned: string[], cwds: string[] = []): MonitorSpawner {
  return (command, opts) => {
    spawned.push(command)
    cwds.push(`${opts.cwd} ${opts.env.CLAUDE_PROJECT_DIR}`)
    let exit!: (code: number) => void
    const exited = new Promise<number>((resolve) => (exit = resolve))
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller
        controller.enqueue(new TextEncoder().encode(`${command} up\n`))
      },
    })
    return {
      stdout,
      exited,
      kill: () => {
        ctrl.close()
        exit(0)
      },
    }
  }
}

function host(
  spawned: string[],
  deliver: (note: MonitorNotification) => void = () => {},
  cwds: string[] = [],
) {
  return createPluginMonitorHost({
    availabilityFor: async () => ON,
    repo: repo(['ops']),
    userId: 'u1',
    cwd: home(),
    homeDir: home(),
    deliver,
    spawn: spawner(spawned, cwds),
  })
}

const DEPLOY_WATCH = {
  name: 'deploy-status',
  command: 'watch-deploy',
  when: 'on-skill-invoke:deploy',
}

describe('an on-skill-invoke monitor', () => {
  test('waits for its skill, then starts once and reaches the chat that ran it', async () => {
    await writePlugin('ops', [DEPLOY_WATCH, { name: 'tail', command: 'tail-log' }])
    const spawned: string[] = []
    let delivered!: (note: MonitorNotification) => void
    const firstLine = new Promise<MonitorNotification>((resolve) => (delivered = resolve))
    const monitors = host(spawned, (note) => delivered(note))
    await monitors.start()
    expect(spawned).toEqual(['tail-log'])

    // Another skill, or a skill of the same name from elsewhere, does not start it.
    expect(
      await monitors.skillInvoked({
        userId: 'u1',
        sessionId: 'c1',
        skillName: 'lint',
        pluginName: 'ops',
      }),
    ).toEqual([])
    expect(
      await monitors.skillInvoked({ userId: 'u1', sessionId: 'c1', skillName: 'deploy' }),
    ).toEqual([])
    expect(
      await monitors.skillInvoked({
        userId: 'u2',
        sessionId: 'c1',
        skillName: 'deploy',
        pluginName: 'ops',
      }),
    ).toEqual([])
    expect(spawned).toEqual(['tail-log'])

    expect(
      await monitors.skillInvoked({
        userId: 'u1',
        sessionId: 'c1',
        skillName: 'deploy',
        pluginName: 'ops',
      }),
    ).toEqual(['ops:deploy-status'])
    expect(spawned).toEqual(['tail-log', 'watch-deploy'])
    expect(monitors.running().sort()).toEqual(['ops:deploy-status', 'ops:tail'])
    const note = await firstLine
    expect(note).toMatchObject({ monitorName: 'deploy-status', sessionIds: ['c1'] })

    // A second run does not start a second process; another chat is armed beside the first.
    await monitors.skillInvoked({
      userId: 'u1',
      sessionId: 'c2',
      skillName: 'deploy',
      pluginName: 'ops',
    })
    expect(spawned).toEqual(['tail-log', 'watch-deploy'])

    // Once started it runs like an `always` monitor: a restart brings it back.
    await monitors.start()
    expect(spawned.filter((cmd) => cmd === 'watch-deploy')).toHaveLength(2)
    await monitors.stop()
    expect(monitors.running()).toEqual([])
  })

  // Claude Code runs a monitor "in the session working directory": the chat that ran the skill.
  test('starts in the working directory of the chat that ran the skill', async () => {
    await writePlugin('ops', [DEPLOY_WATCH])
    const cwds: string[] = []
    const monitors = host([], () => {}, cwds)
    await monitors.start()
    await monitors.skillInvoked({
      userId: 'u1',
      sessionId: 'c1',
      skillName: 'deploy',
      pluginName: 'ops',
      cwd: '/work/repo',
    })
    expect(cwds).toEqual(['/work/repo /work/repo'])
    await monitors.stop()
  })

  test('the skill tool’s `get` and the announcement reach the host', async () => {
    await writePlugin('ops', [DEPLOY_WATCH])
    const spawned: string[] = []
    const monitors = host(spawned)
    await monitors.start()
    const started: Promise<string[]>[] = []
    setSkillInvocationListener((invocation) => {
      const result = monitors.skillInvoked(invocation)
      started.push(result)
      return result
    })
    try {
      const skill: DiscoveredSkill = {
        name: 'deploy',
        description: 'Ship it',
        content: 'Deploy.',
        scope: 'global',
        path: join(home(), 'SKILL.md'),
        dir: home(),
        pluginName: 'ops',
      }
      const tool = createSkillTool(null, [skill], {}, '', undefined, (loaded) =>
        announceSkillInvoked({
          userId: 'u1',
          sessionId: 'c1',
          skillName: loaded.name,
          ...(loaded.pluginName ? { pluginName: loaded.pluginName } : {}),
        }),
      )
      const out = await tool.execute('t', { action: 'get', name: 'deploy' } as never)
      expect(out.isError).toBeFalsy()
      expect(await Promise.all(started)).toEqual([['ops:deploy-status']])
      expect(spawned).toEqual(['watch-deploy'])
    } finally {
      setSkillInvocationListener(null)
      await monitors.stop()
    }
  })
})

describe('monitorWaitsForSkill', () => {
  const loaded = (when: string) => ({
    pluginName: 'ops',
    pluginRoot: '/p',
    dataDir: '/d',
    monitor: { name: 'm', command: 'x', description: '', when },
  })
  test.each([
    ['on-skill-invoke:deploy', { skillName: 'deploy', pluginName: 'ops' }, true],
    ['on-skill-invoke:ops:deploy', { skillName: 'deploy', pluginName: 'ops' }, true],
    ['on-skill-invoke:Deploy', { skillName: 'deploy', pluginName: 'ops' }, true],
    ['on-skill-invoke:infra:deploy', { skillName: 'deploy', pluginName: 'infra' }, true],
    ['on-skill-invoke:deploy', { skillName: 'deploy', pluginName: 'infra' }, false],
    ['on-skill-invoke:deploy', { skillName: 'deploy' }, false],
    ['on-skill-invoke:deploy', { skillName: 'deployer', pluginName: 'ops' }, false],
    ['always', { skillName: 'deploy', pluginName: 'ops' }, false],
  ] as const)('%s for %o → %p', (when, skill, expected) => {
    expect(monitorWaitsForSkill(loaded(when), skill)).toBe(expected)
  })
})
