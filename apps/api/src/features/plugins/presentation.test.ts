import { describe, expect, it } from 'bun:test'
import type { PluginRecord } from './contracts'
import { pluginCapabilityLabels, pluginIssueSummary } from './presentation'

const provides = {
  skills: ['docs'],
  mcpServers: ['context'],
  commands: ['run'],
  agents: ['plugin:reviewer'],
  lspServers: ['typescript'],
}

describe('plugin presentation', () => {
  it('labels every Claude Code capability a plugin declares', () => {
    expect(pluginCapabilityLabels(provides)).toEqual([
      '1 MCP server',
      '1 skill',
      '1 command',
      '1 agent',
      '1 LSP server',
    ])
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
