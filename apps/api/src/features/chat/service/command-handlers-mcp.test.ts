import { expect, test } from 'bun:test'

import type { McpServerRecord } from '../../mcp/repository'
import type { McpServerOutcome } from '../../mcp/mcp-gather'
import {
  mcpSourceOf,
  parseMcpCommand,
  renderMcpListing,
  runMcpCommand,
  statusText,
  type McpCommandPorts,
} from './command-handlers-mcp'

const record = (
  id: string,
  name: string,
  over: Partial<McpServerRecord> = {},
): McpServerRecord => ({
  id,
  userId: 'u',
  projectId: '',
  name,
  description: '',
  transport: 'stdio',
  config: { command: ['x', 'y'] },
  createdAt: '',
  updatedAt: '',
  ...over,
})

test('a server’s source is read from its record: Claude Code scope, plugin, or Localix’s own', () => {
  expect(mcpSourceOf(record('claude-code:user:a', 'a'))).toBe('user')
  expect(mcpSourceOf(record('claude-code:project:a', 'a'))).toBe('project')
  expect(mcpSourceOf(record('claude-code:local:a', 'a'))).toBe('local')
  expect(mcpSourceOf(record('claude-code:managed:a', 'a'))).toBe('managed')
  expect(mcpSourceOf(record('plugin:kit:echo', 'kit_echo'))).toBe('plugin')
  expect(mcpSourceOf(record('abc', 'own'))).toBe('localix')
  expect(mcpSourceOf(record('abc', 'own', { projectId: 'p1' }))).toBe('localix-project')
})

test('/mcp parses its sub-commands, reading none as the listing', () => {
  expect(parseMcpCommand('/mcp')).toEqual({ action: 'list' })
  expect(parseMcpCommand('/mcp list')).toEqual({ action: 'list' })
  expect(parseMcpCommand('/mcp reconnect  my srv')).toEqual({
    action: 'reconnect',
    target: 'my srv',
  })
  expect(parseMcpCommand('/mcp DISABLE all')).toEqual({ action: 'disable', target: 'all' })
  expect(parseMcpCommand('/mcp frobnicate')).toEqual({ action: 'unknown', target: 'frobnicate' })
})

test('/mcp groups servers by where they come from, in a fixed order', () => {
  const row = (
    label: string,
    source: Parameters<typeof renderMcpListing>[0][number]['source'],
  ) => ({
    label,
    source,
    transport: 'http',
    enabled: true,
    status: undefined,
  })
  const reply = renderMcpListing([
    row('plugin:kit:echo', 'plugin'),
    row('own', 'localix'),
    row('proj', 'project'),
    row('org', 'managed'),
    row('mine', 'user'),
    row('loc', 'local'),
  ])
  const headings = reply.split('\n').filter((line) => line.startsWith('###'))
  expect(headings).toEqual([
    '### Localix',
    '### User',
    '### Project (.mcp.json)',
    '### Local',
    '### Managed',
    '### Plugin',
  ])
  expect(reply.indexOf('`own`')).toBeLessThan(reply.indexOf('`plugin:kit:echo`'))
  expect(reply).not.toContain('### Project (.mcp.json)\n\n###')
})

test('a server switched off reads as disabled, and the other states in Claude Code’s words', () => {
  const off = renderMcpListing([
    { label: 'x', source: 'plugin', enabled: false, status: undefined },
  ])
  expect(off).toContain('disabled')
  expect(statusText({ name: 'x', ok: false, toolCount: 0, cached: false, pending: true })).toBe(
    'connecting',
  )
  expect(statusText({ name: 'x', ok: true, toolCount: 3, cached: true })).toBe(
    'cached · connects on first use · 3 tools',
  )
  expect(renderMcpListing([])).toContain('No MCP servers configured')
})

/** Ports over a few records, remembering what the command did. */
function ports(records: McpServerRecord[], off: string[] = []) {
  const calls: string[] = []
  const disabled = new Set(off)
  const status = new Map<string, McpServerOutcome>()
  const p: McpCommandPorts = {
    servers: async () => records,
    cwd: '/work',
    enabled: (name) => !disabled.has(name),
    setEnabled: async (names, enabled) => {
      for (const name of names) {
        calls.push(`${enabled ? 'on' : 'off'}:${name}`)
        if (enabled) disabled.delete(name)
        else disabled.add(name)
      }
    },
    status: (r) => status.get(r.id),
    reconnect: async (r, cwd) => {
      calls.push(`reconnect:${r.name}@${cwd}`)
      const outcome: McpServerOutcome = { name: r.name, ok: true, toolCount: 2, cached: false }
      status.set(r.id, outcome)
      return outcome
    },
  }
  return { p, calls }
}

test('/mcp disable and enable switch a server by its name, and by its plugin label', async () => {
  const { p, calls } = ports([
    record('claude-code:user:github', 'github'),
    record('plugin:kit:echo', 'kit_echo'),
  ])
  expect(await runMcpCommand(p, { action: 'disable', target: 'github' })).toContain('Disabled')
  expect(await runMcpCommand(p, { action: 'disable', target: 'plugin:kit:echo' })).toContain(
    'Disabled',
  )
  expect(await runMcpCommand(p, { action: 'enable', target: 'github' })).toContain('Enabled')
  expect(calls).toEqual(['off:github', 'off:kit_echo', 'on:github'])
})

test('/mcp disable all switches every server that is on, and names none that is unknown', async () => {
  const { p, calls } = ports([record('a', 'a'), record('b', 'b')], ['b'])
  await runMcpCommand(p, { action: 'disable', target: 'all' })
  expect(calls).toEqual(['off:a'])
  const reply = await runMcpCommand(p, { action: 'enable', target: 'nope' })
  expect(reply).toContain('No MCP server named `nope`')
  expect(reply).toContain('`a`')
  expect(await runMcpCommand(p, { action: 'enable' })).toContain('Usage')
})

test('/mcp reconnect connects now and reports; a disabled server is not reconnected', async () => {
  const { p, calls } = ports([record('a', 'a'), record('b', 'b')], ['b'])
  const reply = await runMcpCommand(p, { action: 'reconnect', target: 'a' })
  expect(calls).toEqual(['reconnect:a@/work'])
  expect(reply).toContain('Reconnected')
  expect(reply).toContain('2 tools')
  expect(await runMcpCommand(p, { action: 'reconnect', target: 'b' })).toContain('disabled')
  expect(calls).toHaveLength(1)
})
