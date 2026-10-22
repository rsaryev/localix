import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import type { ModScene, ModSource, ModsPorts } from './contracts'
import { createModsHost } from './host'
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
  const scene: ModScene = { userId: 'u1', sessionId: 's1', cwd: dir }
  return {
    host,
    source,
    changes,
    reports,
    scope: createModRunScope(host, scene, new Set(['first-mod'])),
  }
}

describe('mods host', () => {
  test('a mod loads, registers at session.start, guards and counts tool calls', async () => {
    const { host, scope, reports } = await loadFirstMod()
    expect(reports).toEqual([])
    expect(host.loaded()).toEqual(['first-mod'])
    expect(host.registry.commands().map((command) => command.name)).toEqual(['tally'])

    const [read, bash] = scope.wrapTools([tool('read'), tool('bash')])
    expect((await read!.execute('t1', {})).content).toBe('read ran')
    await expect(bash!.execute('t2', { command: 'ls' })).rejects.toThrow(
      'Bash is off: use the file tools',
    )

    const [count] = scope.tools()
    expect(count!.name).toBe('mcp__first-mod__count')
    expect((await count!.execute('t3', {})).content).toBe('count is 1')

    expect(await host.runCommand({ command: 'tally' }, { userId: 'u1', cwd: '/' })).toEqual({
      text: 'Claude has made 1 tool calls',
    })
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
    const { host, changes } = await loadFirstMod()
    const tools = createModRunScope(host, { userId: 'u1', cwd: '/' }, new Set(['first-mod']))
    await tools.wrapTools([tool('read')])[0]!.execute('t1', {})
    const drawing = await host.panes.render('first-mod', 'tally')
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
    expect(
      await host.panes.interact('first-mod', 'tally', { kind: 'press', element: 'reset' }),
    ).toBe(true)
    expect(changes.length).toBeGreaterThan(before)
    expect((await host.panes.render('first-mod', 'tally'))?.tree?.[0]).toMatchObject({
      children: [{ children: ['Calls: 0'] }, expect.anything()],
    })
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
})
