import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createScriptVms } from '@localixai/engine-scripts'
import { createModComposer } from '../composer'
import {
  INERT_MOD_PORTS,
  NO_USAGE,
  type ModScene,
  type ModSource,
  type ModsPorts,
} from '../contracts'
import { createSessionMods, type SessionModsDeps } from './session-host'

/** A Localix conversation's mods on the kit's host: real hooks modules in VMs, Localix's ports. */

const vms = createScriptVms()
const scratch = tempDirPerTest('mods-session-host', {})

function setup(overrides: Partial<ModsPorts> = {}, more: Partial<SessionModsDeps> = {}) {
  const dir = scratch()
  const logs: string[] = []
  const reports: string[] = []
  const ports: ModsPorts = {
    ...INERT_MOD_PORTS,
    workspaceDir: dir,
    dataDir: (plugin) => join(dir, 'data', plugin),
    log: (_scene, { plugin, text }) => void logs.push(`${plugin}|${text}`),
    report: (plugin, message) => void reports.push(`${plugin}: ${message}`),
    ...overrides,
  }
  const composer = createModComposer(() => {})
  const mods = createSessionMods({
    ports,
    composer,
    rerun: () => {},
    vms,
    homeDir: dir,
    builtIns: () => ['help'],
    hangMs: 2_000,
    memoryLimitBytes: 32 * 1024 * 1024,
    maxHosts: 2,
    managed: null,
    ...more,
  })
  const source = (
    plugin: string,
    code: string,
    revision = '1',
    extra: { userConfig?: unknown; options?: Record<string, unknown> } = {},
  ): ModSource => {
    const root = join(dir, 'plugins', plugin)
    writeTree(root, {
      '.claude-plugin/plugin.json': JSON.stringify({
        name: plugin,
        version: '1.0.0',
        ...(extra.userConfig ? { userConfig: extra.userConfig } : {}),
      }),
      'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
      'hooks/register.js': code,
    })
    const options = extra.options ?? {}
    return { plugin, root, module: join(root, 'hooks/register.js'), options, revision }
  }
  const scene = (sessionId: string): ModScene => ({ userId: 'u', sessionId, cwd: dir })
  return { dir, logs, reports, mods, composer, source, scene }
}

test("a mod's $ reaches the conversation: its cwd, its model route and its transcript notices", async () => {
  const asked: string[] = []
  const { dir, logs, reports, mods, source, scene } = setup({
    complete: async (_scene, request) => {
      asked.push(request.prompt)
      return { isAnswered: true, text: 'pong', usage: NO_USAGE }
    },
  })
  const host = await mods.hostFor(scene('s1'), [
    source(
      'pinger',
      `export function register(on) {
        on('command.run', { command: 'ping' }, async ($) => {
          const reply = await $.model.complete({ model: 'haiku', prompt: 'ping', maxTokens: 10 })
          $.ui.log('asked')
          return { text: (await $.session.cwd()) + ' ' + reply.text }
        })
      }`,
    ),
  ])
  const answer = await host.runCommand('ping', '')
  expect(reports).toEqual([])
  expect(answer).toEqual({ text: `${dir} pong` })
  expect(asked).toEqual(['ping'])
  expect(logs).toEqual(['pinger|● pinger: asked'])
})

test('$.prompt.fill puts a draft in the conversation box', async () => {
  const { mods, composer, source, scene } = setup()
  const host = await mods.hostFor(scene('s1'), [
    source(
      'filler',
      `export function register(on) {
        on('command.run', { command: 'draft' }, async ($) => {
          const filled = await $.prompt.fill('hello there')
          return { text: String(filled.isFilled) }
        })
      }`,
    ),
  ])
  expect(await host.runCommand('draft', '')).toEqual({ text: 'true' })
  expect(composer.view('s1').fills.map((fill) => fill.text)).toEqual(['hello there'])
})

test('each conversation has a host of its own, kept until its mods change or it is the oldest', async () => {
  const { mods, source, scene } = setup()
  const code = `export function register(on) {}`
  const first = await mods.hostFor(scene('a'), [source('m', code)])
  expect(await mods.hostFor(scene('a'), [source('m', code)])).toBe(first)
  expect(await mods.hostFor(scene('a'), [source('m', code, '2')])).not.toBe(first)
  await mods.hostFor(scene('b'), [source('m', code)])
  await mods.hostFor(scene('c'), [source('m', code)])
  expect(mods.size()).toBe(2)
  await mods.stop()
  expect(mods.size()).toBe(0)
})

test('a conversation whose host goes hears session.end, naming the conversation', async () => {
  const { mods, logs, source, scene } = setup()
  const code = `export function register(on) {
    on('session.end', ($, e) => { $.ui.log(e.reason + ' ' + e.sessionId + ' ' + e.resume.id) })
  }`
  await mods.hostFor(scene('a'), [source('m', code)])
  await mods.drop(scene('a'))
  expect(logs).toEqual(['m|● m: other a a'])
})

test("a module that fails to load is reported, by the kit's line", async () => {
  const { mods, reports, source, scene } = setup()
  await mods.hostFor(scene('s1'), [
    source('broken', `export function register() { throw new Error('nope') }`),
  ])
  expect(reports.some((line) => line.includes('nope'))).toBe(true)
})

test('a plugin’s saved options reach its module’s register', async () => {
  const { mods, source, scene } = setup()
  const userConfig = { greeting: { type: 'string', title: 'Greeting', description: 'What to say' } }
  const host = await mods.hostFor(scene('s1'), [
    source(
      'greeter',
      `export function register(on, options) {
        on('command.run', { command: 'greet' }, async () => ({ text: String(options.greeting) }))
      }`,
      '1',
      { userConfig, options: { greeting: 'hello' } },
    ),
  ])
  expect(await host.runCommand('greet', '')).toEqual({ text: 'hello' })
})

test('under managed settings, a user mod’s approval of a call the rules deny is refused', async () => {
  const managedDir = join(scratch(), 'managed')
  writeTree(managedDir, {
    'managed-settings.json': JSON.stringify({ permissions: { deny: ['Bash(rm:*)'] } }),
  })
  const { mods, source, scene } = setup({}, { managed: { dir: managedDir } })
  const host = await mods.hostFor(scene('s1'), [
    source(
      'approver',
      `export function register(on) {
        on('tool.check', async () => ({ decision: 'allow' }))
      }`,
    ),
  ])
  const check = (command: string) =>
    host.fire(
      'tool.check',
      { tool: 'Bash', input: { command } },
      { core: async () => ({ decision: 'ask' }) },
    )
  expect(await check('rm -rf build')).toMatchObject({ decision: 'deny' })
  expect(await check('ls')).toMatchObject({ decision: 'allow' })
})

test('$.tool.call runs the turn’s gated tool: a call the gate refuses is refused to the mod', async () => {
  const ran: unknown[] = []
  const bash = {
    name: 'Bash',
    description: 'Bash',
    execute: async (_id: string, input: unknown) => {
      ran.push(input)
      throw Object.assign(new Error('Blocked by the Claude Code permission rule Bash(rm:*)'), {
        blocked: true,
      })
    },
  }
  const { mods, source, scene } = setup({}, { turnOf: () => ({ tools: [bash] as never[] }) })
  const host = await mods.hostFor(scene('s1'), [
    source(
      'caller',
      `export function register(on) {
        on('command.run', { command: 'wipe' }, async ($) => {
          try { await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }); return { text: 'ran' } }
          catch (error) { return { text: String(error.message) } }
        })
      }`,
    ),
  ])
  const answer = (await host.runCommand('wipe', '')) as { text: string }
  expect(answer.text).toContain('Blocked by the Claude Code permission rule')
  expect(ran).toHaveLength(1)
})

test("a hook's $.command.run reaches the mod's other hook while that one runs elsewhere", async () => {
  // Only the calling hook is skipped (claude-code/index.d.ts:7298): the kit knows which hook made
  // the call through the async context the VM's calls run in (`asyncContext`, `stand-in.ts`).
  const gate = Promise.withResolvers<void>()
  const asked = Promise.withResolvers<void>()
  const { mods, source, scene } = setup({
    complete: async () => {
      asked.resolve()
      await gate.promise
      return { isAnswered: true, text: 'slow done', usage: NO_USAGE }
    },
  })
  const host = await mods.hostFor(scene('s1'), [
    source(
      'pair',
      `export function register(on) {
        on('tool.call', async ($) => ({ value: await $.command.run({ command: 'probe' }) }))
        on('command.run', async ($, e, next) => {
          if (e.command === 'slow')
            return { text: (await $.model.complete({ model: 'haiku', prompt: 'x', maxTokens: 1 })).text }
          return e.command === 'probe' ? { text: 'B answered' } : next(e)
        })
      }`,
    ),
  ])
  const slow = host.runCommand('slow', '')
  await asked.promise
  expect(await host.fire('tool.call', { tool: 'Read', input: {} })).toEqual({
    value: { text: 'B answered' },
  })
  gate.resolve()
  expect(await slow).toEqual({ text: 'slow done' })
  await mods.stop()
})

/** A clock the test moves: timers fire when it passes them. */
function manualClock() {
  let now = 0
  const timers = new Set<{ at: number; fire: () => void }>()
  return {
    now: () => now,
    setTimer(fire: () => void, ms: number) {
      const timer = { at: now + ms, fire }
      timers.add(timer)
      return () => void timers.delete(timer)
    },
    advance(ms: number) {
      now += ms
      for (const timer of timers)
        if (timer.at <= now) {
          timers.delete(timer)
          timer.fire()
        }
    },
  }
}

test("a conversation's host idle past `idleMs` goes; its next use loads it anew", async () => {
  const clock = manualClock()
  const { mods, source, scene } = setup({}, { idleMs: 40, clock })
  const mod = source(
    'idler',
    `export function register(on) { on('command.run', () => ({ text: 'up' })) }`,
  )
  const first = await mods.hostFor(scene('s1'), [mod])
  clock.advance(30)
  expect(mods.size()).toBe(1)
  clock.advance(10)
  expect(mods.size()).toBe(0)
  const again = await mods.hostFor(scene('s1'), [mod])
  expect(again).not.toBe(first)
  expect(await again.runCommand('x', '')).toEqual({ text: 'up' })
  await mods.stop()
})

test('a host whose turn runs is not idle', async () => {
  const clock = manualClock()
  const { mods, source, scene } = setup({}, { idleMs: 40, clock, turnOf: () => ({ tools: [] }) })
  await mods.hostFor(scene('s1'), [source('busy', `export function register(on) {}`)])
  clock.advance(100)
  expect(mods.size()).toBe(1)
  await mods.stop()
})
