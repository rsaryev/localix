import type { PluginProvides, PluginRecord } from './contracts'

function countLabel(count: number, singular: string, plural = `${singular}s`): string | null {
  return count > 0 ? `${count} ${count === 1 ? singular : plural}` : null
}

/** Compact capability labels shared by every client surface. */
export function pluginCapabilityLabels(provides: PluginProvides, enabled: boolean): string[] {
  const labels: Array<string | null> = [
    enabled && provides.tools.length > 0
      ? countLabel(provides.tools.length, 'tool')
      : provides.hasNativeTools
        ? 'native tools'
        : null,
    countLabel(provides.mcpServers.length, 'MCP server'),
    countLabel(provides.skills.length, 'skill'),
    countLabel(provides.commands.length, 'command'),
    countLabel(provides.agents?.length ?? 0, 'agent'),
    countLabel(provides.lspServers?.length ?? 0, 'LSP server'),
    countLabel(provides.backendSubsystems?.length ?? 0, 'backend subsystem'),
  ]
  return labels.filter((label): label is string => label !== null)
}

/**
 * Where a plugin came from, as the ONE word every surface shows: a bundled plugin
 * ships with the app, otherwise it is scoped to a project or installed globally.
 *
 * `bundled` has to win over the scope: a bundled plugin also carries a scope, and a
 * surface that checked `projectId` first labelled the shipped ones "global" — true,
 * and useless for the only question the label answers, which is whether the user
 * installed it.
 */
export function pluginOriginLabel(plugin: PluginRecord): 'bundled' | 'project' | 'global' {
  if (plugin.bundled) return 'bundled'
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
