import type { ClaudePluginManifest, PluginIssue, UserConfigOption } from '@localixai/claude-plugin'

/**
 * A Claude Code plugin manifest as the runtime manifest the loader reads. Field names mostly
 * coincide; what differs is said here:
 *  - `userConfig` → `config`, with `sensitive` → `secret`;
 *  - `experimental.monitors` (or the top-level alias) → `monitors`;
 *  - listed `commands` / `agents` REPLACE their default folder → `defaultDirs: { <field>: false }`;
 *  - the `commands` object map → inline commands (`content`) or command files (`source`).
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

  for (const [field, why] of UNSUPPORTED) {
    if (field(manifest)) issues.push({ severity: 'warning', path: why[0], message: why[1] })
  }
  return out
}

const UNSUPPORTED: Array<[(manifest: ClaudePluginManifest) => unknown, [string, string]]> = [
  [(m) => m.outputStyles, ['outputStyles', 'Output styles are not used by Localix']],
  [(m) => m.workflows, ['workflows', 'Workflows are not used by Localix']],
  [(m) => m.experimental?.themes ?? m.themes, ['themes', 'Themes are not used by Localix']],
  [(m) => m.channels, ['channels', 'Claude Code channels are not used by Localix']],
  [
    (m) => m.settings,
    ['settings', 'Plugin settings (agent, subagentStatusLine) are not used by Localix'],
  ],
]

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
