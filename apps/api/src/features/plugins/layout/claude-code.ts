import type { ClaudePluginManifest, PluginIssue, UserConfigOption } from '@localixai/claude-plugin'

/**
 * A Claude Code plugin manifest as the runtime manifest the loader reads. Field names mostly
 * coincide; what differs is said here:
 *  - `userConfig` → `config`, with `sensitive` → `secret`;
 *  - `experimental.monitors` (or the top-level alias) → `monitors`;
 *  - listed `commands` / `agents` REPLACE their default folder → `defaultDirs: { <field>: false }`;
 *  - the `commands` object map → inline commands (`content`) or command files (`source`);
 *  - `experimental.themes` (or the top-level alias) → `themes`;
 *  - each `channels` entry's `userConfig` → options in the plugin's `config`.
 * What Localix does not run is reported, never dropped silently.
 */
export function fromClaudePlugin(
  manifest: ClaudePluginManifest,
  issues: PluginIssue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { name: manifest.name, origin: { format: 'claude-code' } }
  for (const field of [
    'version',
    'description',
    'displayName',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
    'defaultEnabled',
    'skills',
    'hooks',
    'mcpServers',
    'lspServers',
  ] as const) {
    if (manifest[field] !== undefined) out[field] = manifest[field]
  }
  if (manifest.userConfig) out.config = configOf(manifest.userConfig, issues)
  const monitors = manifest.experimental?.monitors ?? manifest.monitors
  if (monitors !== undefined) out.monitors = monitors
  if (manifest.dependencies)
    out.dependencies = manifest.dependencies.map((dependency) =>
      typeof dependency === 'string'
        ? dependency.split('@')[0]
        : { name: dependency.name, ...(dependency.version ? { version: dependency.version } : {}) },
    )

  const defaultDirs: Record<string, boolean> = {}
  if (manifest.agents !== undefined) {
    out.agents = typeof manifest.agents === 'string' ? [manifest.agents] : manifest.agents
    defaultDirs.agents = false
  }
  if (manifest.commands !== undefined) {
    out.commands = commandsOf(manifest.commands, issues)
    defaultDirs.commands = false
  }
  if (Object.keys(defaultDirs).length) out.defaultDirs = defaultDirs

  // Output styles, themes and workflows replace their default folder; `settings` yields to a root
  // `settings.json` (both read in `discovery-cc-components.ts`).
  if (manifest.outputStyles !== undefined) out.outputStyles = manifest.outputStyles
  if (manifest.workflows !== undefined) out.workflows = manifest.workflows
  const themes = manifest.experimental?.themes ?? manifest.themes
  if (themes !== undefined) out.themes = themes
  if (manifest.settings !== undefined) out.settings = manifest.settings
  if (manifest.channels) {
    out.channels = manifest.channels.map(({ server, displayName }) => ({
      server,
      ...(displayName ? { displayName } : {}),
    }))
    // A channel's options substitute into its server's `${user_config.KEY}`, as the plugin's own
    // do: one settings form holds both, the plugin's option winning a shared key.
    const channelOptions = Object.assign(
      {},
      ...manifest.channels.map((channel) => channel.userConfig ?? {}),
    ) as Record<string, UserConfigOption>
    if (Object.keys(channelOptions).length)
      out.config = { ...configOf(channelOptions, issues), ...(out.config as object | undefined) }
  }
  return out
}

function configOf(
  options: Record<string, UserConfigOption>,
  issues: PluginIssue[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(options).map(([key, option]) => {
      const { sensitive, options: _choices, default: fallback, ...rest } = option
      const converted: Record<string, unknown> = { ...rest, ...(sensitive ? { secret: true } : {}) }
      // A `multiple` option's list default has no scalar form here: it starts empty instead.
      if (Array.isArray(fallback))
        issues.push({
          severity: 'warning',
          path: `userConfig.${key}`,
          message: `The list default of "${key}" is not applied; the option starts empty`,
        })
      else if (fallback !== undefined) converted.default = fallback
      return [key, converted]
    }),
  )
}

function commandsOf(
  commands: NonNullable<ClaudePluginManifest['commands']>,
  issues: PluginIssue[],
): unknown[] {
  if (typeof commands === 'string') return [commands]
  if (Array.isArray(commands)) return commands
  return Object.entries(commands).map(([name, entry]) => {
    if (entry.source !== undefined) {
      const file = entry.source.split('/').at(-1)?.replace(/\.md$/i, '')
      if (file !== name)
        issues.push({
          severity: 'warning',
          path: `commands.${name}`,
          message: `"${name}" runs as /${file}: Localix names a command after its file`,
        })
      return entry.source
    }
    return {
      name,
      description: entry.description ?? '',
      prompt: entry.content ?? '',
      ...(entry.argumentHint ? { argumentHint: entry.argumentHint } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.allowedTools ? { allowedTools: entry.allowedTools } : {}),
    }
  })
}
