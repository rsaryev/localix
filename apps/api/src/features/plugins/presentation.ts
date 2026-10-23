import type { PluginProvides, PluginRecord } from './contracts'

function countLabel(count: number, singular: string, plural = `${singular}s`): string | null {
  return count > 0 ? `${count} ${count === 1 ? singular : plural}` : null
}

/** Compact capability labels shared by every client surface. */
export function pluginCapabilityLabels(provides: PluginProvides): string[] {
  const labels: Array<string | null> = [
    countLabel(provides.mcpServers.length, 'MCP server'),
    countLabel(provides.skills.length, 'skill'),
    countLabel(provides.commands.length, 'command'),
    countLabel(provides.agents?.length ?? 0, 'agent'),
    countLabel(provides.lspServers?.length ?? 0, 'LSP server'),
  ]
  return labels.filter((label): label is string => label !== null)
}

/** Where a plugin is installed, as the one word every surface shows. */
export function pluginOriginLabel(plugin: PluginRecord): 'project' | 'global' {
  return plugin.projectId ? 'project' : 'global'
}

export interface PluginIssueSummary {
  errors: string[]
  warnings: string[]
  label: string | null
}

/** Merge load and validation failures once, with errors taking precedence. */
export function pluginIssueSummary(plugin: PluginRecord): PluginIssueSummary {
  const errors = [...(plugin.error ? [plugin.error] : []), ...plugin.validation.errors]
  const warnings = plugin.validation.warnings
  const label =
    errors.length > 0
      ? 'invalid'
      : warnings.length > 0
        ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
        : null
  return { errors, warnings, label }
}
