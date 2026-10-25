import { pluginOriginLabel } from '../../plugins/presentation'
import type { CommandHandlerContext } from './command-handlers'

type PluginRecord = Awaited<
  ReturnType<CommandHandlerContext['pluginService']['listPlugins']>
>['plugins'][number]
type SessionPluginCatalog = Awaited<ReturnType<CommandHandlerContext['buildSessionPluginCatalog']>>

/** `/plugin details <name>`: one plugin's state, origin, validation and what it provides. */
export function pluginDetailsReply(p: PluginRecord): string {
  const chips: string[] = []
  if (p.provides.skills.length) chips.push(`skills: ${p.provides.skills.join(', ')}`)
  if (p.provides.mcpServers.length) chips.push(`MCP: ${p.provides.mcpServers.join(', ')}`)
  if (p.provides.commands.length) chips.push(`commands: ${p.provides.commands.join(', ')}`)
  if (p.provides.agents?.length) chips.push(`agents: ${p.provides.agents.join(', ')}`)
  const errWarn =
    p.validation.errors.length + p.validation.warnings.length === 0
      ? 'clean'
      : `${p.validation.errors.length} error(s), ${p.validation.warnings.length} warning(s)`
  const lines = [
    `**${p.name}**${p.displayName && p.displayName !== p.name ? ` (${p.displayName})` : ''} v${p.version} — ${p.description || '(no description)'}`,
    `- **Enabled:** ${p.enabled ? 'yes' : 'no'} | **Origin:** ${pluginOriginLabel(p)} | **Source:** ${p.source}`,
    ...(p.importedFrom === 'claude-code'
      ? [`- **Imported from Claude Code**${p.migratedFrom ? `: ${p.migratedFrom}` : ''}`]
      : p.migratedFrom
        ? [`- **Migrated from:** ${p.migratedFrom}`]
        : []),
    `- **Validation:** ${errWarn}`,
    ...(chips.length ? [`- **Provides:** ${chips.join(' | ')}`] : []),
    ...(p.error ? [`- **Load error:** ${p.error}`] : []),
    ...p.validation.errors.map((e) => `  - Error: ${e}`),
    ...p.validation.warnings.map((w) => `  - Warning: ${w}`),
    `- **Dir:** \`${p.dir}\``,
  ]
  return lines.join('\n')
}

/** `/plugin validate`: the validation of each target, strict promoting warnings to errors. */
export function validationReply(targets: readonly PluginRecord[], strict: boolean): string {
  const strictNote = strict ? ' (strict — warnings promoted to errors)' : ''
  const lines = targets.map((p) => {
    // In strict mode, all warnings become errors in the display.
    const errs = [...p.validation.errors, ...(strict ? p.validation.warnings : [])].map(
      (e) => `    - Error: ${e}`,
    )
    const warns = strict ? [] : p.validation.warnings.map((w) => `    - Warning: ${w}`)
    const errCount = p.validation.errors.length + (strict ? p.validation.warnings.length : 0)
    const warnCount = strict ? 0 : p.validation.warnings.length
    const head = `- \`${p.name}\` — ${errCount} error(s), ${warnCount} warning(s)`
    return [head, ...errs, ...warns].join('\n')
  })
  return [`**Plugin validation${strictNote}:**`, '', ...lines].join('\n')
}

/** The bare `/plugin` and `/plugin list`: every plugin discovered for this scope. */
export function pluginListReply(catalog: SessionPluginCatalog): string {
  return catalog.all.length === 0
    ? 'No plugins found. Install one in the Store, or drop a plugin folder (with `.claude-plugin/plugin.json`, as in Claude Code) into `~/.localix/plugins`.'
    : [
        '**Plugins** — enable in the Store:',
        '',
        ...catalog.all.map(({ plugin: p, enabled }) => {
          const scope = p.scope === 'project' ? 'project' : 'global'
          const bits: string[] = []
          if (p.provides.mcpServers.length) bits.push(`${p.provides.mcpServers.length} mcp`)
          if (p.provides.skills.length) bits.push(`${p.provides.skills.length} skills`)
          if (p.provides.commands.length) bits.push(`${p.provides.commands.length} commands`)
          if (p.provides.agents?.length) bits.push(`${p.provides.agents.length} agents`)
          const state = p.error ? 'error' : enabled ? 'enabled' : 'disabled'
          const detail = bits.length ? ` — ${bits.join(', ')}` : ''
          const version = p.manifest.version ? ` · v${p.manifest.version}` : ''
          return `- ${state} \`${p.manifest.name}\` _(${scope})_${detail}${version}`
        }),
      ].join('\n')
}
