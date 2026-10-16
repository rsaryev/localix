import { describe, expect, it } from 'bun:test'
import type { PluginRecord } from './contracts'
import { pluginCapabilityLabels, pluginIssueSummary } from './presentation'

const provides = {
  hasNativeTools: true,
  tools: [
    { name: 'one', label: 'One', description: 'First tool' },
    { name: 'two', label: 'Two', description: 'Second tool' },
  ],
  skills: ['docs'],
  mcpServers: ['context'],
  commands: ['run'],
  agents: ['plugin:reviewer'],
  lspServers: ['typescript'],
  backendSubsystems: ['docs'],
}

describe('plugin presentation', () => {
  it('uses loaded tool counts only while enabled and includes every static capability', () => {
    expect(pluginCapabilityLabels(provides, true)).toEqual([
      '2 tools',
      '1 MCP server',
      '1 skill',
      '1 command',
      '1 agent',
      '1 LSP server',
      '1 backend subsystem',
    ])
    expect(pluginCapabilityLabels(provides, false)[0]).toBe('native tools')
  })

  it('merges load errors with validation and gives errors precedence over warnings', () => {
    const plugin = {
      error: 'Import failed',
      validation: { errors: ['Bad manifest'], warnings: ['Deprecated field'] },
    } as PluginRecord
    expect(pluginIssueSummary(plugin)).toEqual({
      errors: ['Import failed', 'Bad manifest'],
      warnings: ['Deprecated field'],
      label: 'invalid',
    })
  })
})
