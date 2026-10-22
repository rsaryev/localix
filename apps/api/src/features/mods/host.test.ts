import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import type { ModScene, ModSource, ModsPorts } from './contracts'
import { createModsHost } from './host'
import { instanceIdOf } from './instance-id'
import { createModRunScope } from './run-scope'

const scratch = tempDirPerTest('mods-host', {})

/** The tutorial mod from Claude Code's docs, extended with a tool, a pane and a guard. */
const FIRST_MOD = `
let calls = 0
export function register(on, options) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tally', description: 'Show the tool call count' })
    await $.tool.register({ name: 'count', description: 'The count', inputSchema: { type: 'object', properties: {} } })
    await $.ui.open({ id: 'tally', title: 'Tally' })
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async ($, e) => ({ deny: 'Bash is off: ' + options.reason }))
  on('tool.call', { tool: /^mcp__first-mod__count$/ }, async () => ({ result: 'count is ' + calls }))
  on('tool.call', async ($, e, next) => {
    calls += 1
    return next(e)
  })
  on('command.run', { command: 'tally' }, async () => ({ text: 'Claude has made ' + calls + ' tool calls' }))
  on('prompt.submit', async ($, e, next) => next({ ...e, text: e.text.trim(), context: ['from first-mod'] }))
  on('ui.render', { component: 'Pane', requestId: 'tally' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return <Box><Text>{'Calls: ' + calls}</Text><Button key="reset" label="Reset" onPress={() => { calls = 0 }} /></Box>
  })
}
`

function ports(dir: string) {
  const changes: number[] = []
  const reports: string[] = []
  const value: ModsPorts = {
    dataDir: (plugin) => join(dir, 'data', plugin),
    workspaceDir: dir,
    submitPrompt: async () => {},
    complete: async () => ({ isAnswered: false, reason: 'no model' }),
    log: () => {},
    notify: () => {},
    changed: () => changes.push(1),
    report: (plugin, message) => reports.push(`${plugin}: ${message}`),
  }
  return { value, changes, reports }
}

function tool(name: string): AgentTool {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: 'Running',
    inputSchema: z.object({ command: z.string().optional() }),
    execute: async () => ({ content: `${name} ran` }),
  }) as AgentTool
}

async function loadFirstMod() {
  const dir = scratch()
  const root = join(dir, 'first-mod')
  writeTree(root, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'first-mod' }),
    'hooks/hooks.json': JSON.stringify({ modules: ['./register.jsx'] }),
    'hooks/register.jsx': FIRST_MOD,
  })
  const { value, changes, reports } = ports(dir)
  const host = createModsHost(value)
  const source: ModSource = {
    plugin: 'first-mod',
    root,
    module: join(root, 'hooks/register.jsx'),
    options: { reason: 'use the file tools' },
    revision: '1',
  }
  await host.reconcile([source])
  // A chat in the workspace: the same instance the mod started in at load.
  const scene: ModScene = { userId: 'u1', sessionId: 's1', cwd: dir }
  return {
    host,
    dir,
    source,
    changes,
    reports,
    pane: instanceIdOf('first-mod', dir),
    scope: await createModRunScope(host, scene, new Set(['first-mod'])),
  }
}

describe('mods host', () => {
  test('a mod loads, registers at session.start, guards and counts tool calls', async () => {
    const { host, dir, scope, reports } = await loadFirstMod()
    expect(reports).toEqual([])
    expect(host.loaded()).toEqual(['first-mod'])
    expect(host.registry.commands().map((command) => command.name)).toEqual(['tally'])

    const [read, bash] = scope.wrapTools([tool('read'), tool('bash')])
    expect((await read!.execute('t1', {})).content).toBe('read ran')
    // Awaited before `expect`: Bun's `expect(promise).rejects` waits without taking the messages
    // a worker posts, and the mod runs in one.
    const denied = await bash!.execute('t2', { command: 'ls' }).catch((error: Error) => error)
    expect(String(denied)).toContain('Bash is off: use the file tools')

    const [count] = scope.tools()
    expect(count!.name).toBe('mcp__first-mod__count')
    expect((await count!.execute('t3', {})).content).toBe('count is 1')

    expect(
      await host.runCommand(
        { command: 'tally' },
        { userId: 'u1', cwd: dir },
        new Set(['first-mod']),
      ),
    ).toEqual({ text: 'Claude has made 1 tool calls' })
  })

  test('prompt.submit rewrites the prompt and adds notes for the model', async () => {
    const { scope } = await loadFirstMod()
    expect(await scope.submit('  hello  ', 'turn-1')).toEqual({
      dropped: false,
      text: 'hello',
      context: ['from first-mod'],
    })
  })

  test('a pane draws through ui.render, and its button runs the closure', async () => {
    const { host, scope, pane, changes } = await loadFirstMod()
    await scope.wrapTools([tool('read')])[0]!.execute('t1', {})
    const drawing = await host.panes.render(pane, 'tally')
    expect(drawing?.tree).toEqual([
      {
        type: 'Box',
        props: {},
        children: [
          { type: 'Text', props: {}, children: ['Calls: 1'] },
          { type: 'Button', props: { key: 'reset', label: 'Reset' }, children: [] },
        ],
      },
    ])
    const before = changes.length
    expect(await host.panes.interact(pane, 'tally', { kind: 'press', element: 'reset' })).toBe(true)
    expect(changes.length).toBeGreaterThan(before)
    expect((await host.panes.render(pane, 'tally'))?.tree?.[0]).toMatchObject({
      children: [{ children: ['Calls: 0'] }, expect.anything()],
    })
  })

  test('each project runs its own instance of the mod, with its own state', async () => {
    const { host, dir, scope } = await loadFirstMod()
    await scope.wrapTools([tool('read')])[0]!.execute('t1', {})
    const other = await createModRunScope(
      host,
      { userId: 'u1', sessionId: 's2', cwd: join(dir, 'other') },
      new Set(['first-mod']),
    )
    expect(host.instances().size).toBe(2)
    const tally = (cwd: string) =>
      host.runCommand({ command: 'tally' }, { userId: 'u1', cwd }, new Set(['first-mod']))
    expect(await tally(dir)).toEqual({ text: 'Claude has made 1 tool calls' })
    expect(await tally(join(dir, 'other'))).toEqual({ text: 'Claude has made 0 tool calls' })
    expect(other.active).toBe(true)
    // The palette lists a command once, whichever projects run the mod.
    expect(host.registry.commands().map((command) => command.name)).toEqual(['tally'])
  })

  test('unloading takes the mod’s commands, tools and panes with it; a broken module is reported', async () => {
    const { host, source } = await loadFirstMod()
    await host.reconcile([])
    expect(host.loaded()).toEqual([])
    expect(host.registry.commands()).toEqual([])
    expect(host.registry.panes()).toEqual([])
    writeTree(source.root, { 'hooks/register.jsx': 'export const nothing = 1' })
    await host.reconcile([{ ...source, revision: '2' }])
    expect(host.failures().get('first-mod')).toContain('register')
  })

  test('a mod written like Claude Code’s own: chained calls and the conversation in $.session', async () => {
    const dir = scratch()
    const root = join(dir, 'session-mod')
    writeTree(root, {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'session-mod' }),
      'hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
      'hooks/register.ts': `
        export function register(on: any) {
          on('session.start', ($: any, e: any, next: any) =>
            $.command.register({ name: 'recap', description: 'Recap' }).catch(() => {}).then(() => next(e)))
          on('command.run', { command: 'recap' }, async ($: any) => {
            const [turns, model, usage, id] = await Promise.all([
              $.session.turns(), $.session.model(), $.session.usage(), $.session.id(),
            ])
            return { text: id + ': ' + turns + ' turns on ' + model + ', ' + usage.context.percent + '%' }
          })
        }
      `,
    })
    const { value, reports } = ports(dir)
    const host = createModsHost({
      ...value,
      readSession: async (scene) => ({
        messages: [
          { role: 'user', text: 'one', toolUses: [] },
          { role: 'assistant', text: 'ok', toolUses: [] },
          { role: 'user', text: 'two', toolUses: [] },
        ],
        model: 'claude-opus',
        context: { window: 200_000, tokens: scene.sessionId === 's1' ? 50_000 : 0 },
      }),
    })
    await host.reconcile([
      {
        plugin: 'session-mod',
        root,
        module: join(root, 'hooks/register.ts'),
        options: {},
        revision: '1',
      },
    ])
    expect(reports).toEqual([])
    expect(
      await host.runCommand(
        { command: 'recap' },
        { userId: 'u1', sessionId: 's1', cwd: dir },
        new Set(['session-mod']),
      ),
    ).toEqual({ text: 's1: 2 turns on claude-opus, 25%' })
  })

  test('a row a mod appends reaches the model with the next prompt, once', async () => {
    const { host, scope } = await loadFirstMod()
    host.composer.note('s1', 'The build is red.')
    expect(await scope.submit('fix it', 'turn-2')).toMatchObject({
      context: ['The build is red.', 'from first-mod'],
    })
    expect(await scope.submit('again', 'turn-3')).toMatchObject({ context: ['from first-mod'] })
  })

  test('mods in a project judge a new one, and restyle the table its panes draw with', async () => {
    const dir = scratch()
    const mod = (name: string, body: string) => {
      writeTree(join(dir, name), {
        '.claude-plugin/plugin.json': JSON.stringify({ name }),
        'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
        'hooks/register.js': `export function register(on) {\n${body}\n}`,
      })
      return {
        plugin: name,
        root: join(dir, name),
        module: join(dir, name, 'hooks/register.js'),
        options: {},
        revision: '1',
      }
    }
    const { value, reports } = ports(dir)
    const host = createModsHost(value)
    await host.reconcile([
      mod(
        'gate',
        `on('plugin.register', ($, e, next) => e.name === 'bad' ? { refuse: 'not here' } : next(e))
         on('ui.resolve', { component: 'Pane' }, async ($, e, next) => {
           const table = await next(e)
           return { ...table, Text: (props) => table.Text({ ...props, bold: true }) }
         })`,
      ),
      mod('bad', `on('session.start', ($, e, next) => next(e))`),
      mod(
        'drawer',
        `on('session.start', async ($, e, next) => { await $.ui.open({ id: 'p' }); return next(e) })
         on('ui.render', { component: 'Pane' }, ($, e) => $.ui.resolve(e).Text({ children: ['hi'] }))`,
      ),
    ])
    expect(host.loaded()).toEqual(['gate', 'drawer'])
    expect(host.failures().get('bad')).toContain('refused by a mod: not here')
    expect(reports.some((line) => line.startsWith('bad:'))).toBe(true)
    const drawing = await host.panes.render(instanceIdOf('drawer', dir), 'p')
    expect(drawing?.tree).toEqual([{ type: 'Text', props: { bold: true }, children: ['hi'] }])
  })
})
