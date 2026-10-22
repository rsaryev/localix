import { expect, test } from 'bun:test'

import { renderMcpListing, statusText } from './command-handlers-mcp'

test('/mcp lists a plugin’s servers as plugin:<plugin>:<server> and marks one that failed', () => {
  const reply = renderMcpListing([
    {
      label: 'memory',
      transport: 'stdio',
      scope: 'global',
      detail: 'npx memory',
      enabled: true,
      status: undefined,
    },
    {
      label: 'plugin:brokenkit:echo',
      scope: 'plugin',
      enabled: true,
      status: { name: 'brokenkit_echo', ok: true, toolCount: 1, cached: false },
    },
    {
      label: 'plugin:brokenkit:broken',
      scope: 'plugin',
      enabled: true,
      status: { name: 'brokenkit_broken', ok: false, toolCount: 0, cached: false, error: 'ENOENT' },
    },
  ])
  const line = (label: string) => reply.split('\n').find((row) => row.includes(label))
  expect(line('`memory`')).toContain('not connected yet')
  expect(line('plugin:brokenkit:echo')).toContain('✔ connected · 1 tools')
  expect(line('plugin:brokenkit:broken')).toContain('✘ failed to connect: ENOENT')
})

test('a server switched off reads as disabled, and the other states in Claude Code’s words', () => {
  expect(
    renderMcpListing([{ label: 'x', scope: 'plugin', enabled: false, status: undefined }]),
  ).toContain('disabled')
  expect(statusText({ name: 'x', ok: false, toolCount: 0, cached: false, pending: true })).toBe(
    'connecting',
  )
  expect(statusText({ name: 'x', ok: true, toolCount: 3, cached: true })).toBe(
    'cached · connects on first use · 3 tools',
  )
  expect(renderMcpListing([])).toContain('No MCP servers configured')
})
