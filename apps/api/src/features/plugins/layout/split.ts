import { MINI_APP_MANIFEST_FILE } from '@localixai/plugin-sdk/app-manifest'
import { MANIFEST_FILE } from '@localixai/claude-plugin'

/**
 * A legacy root `plugin.json` split into the two layers (the inverse of `compose.ts`): the agent's
 * part as a Claude Code plugin, Localix's part as a mini app. Inline commands become command files
 * in the plugin, their prompt's `${arg}` placeholders Claude Code's `$arg` with an `arguments` list,
 * and their chips and pickers the mini app's `commands`. Pure: the caller writes the files.
 */
export interface SplitManifest {
  /** `.claude-plugin/plugin.json` */
  plugin: Record<string, unknown>
  /** `.localix-app/app.json`, when anything only Localix runs is declared. */
  app: Record<string, unknown> | null
  /** Files to write, relative to the extension folder (the two manifests, command files). */
  files: Record<string, string>
}

/** Plugin fields Claude Code reads, carried as written. */
const PLUGIN_FIELDS = [
  'name',
  'displayName',
  'version',
  'description',
  'homepage',
  'repository',
  'license',
  'keywords',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
  'dependencies',
] as const
/** Fields only Localix runs: their presence makes a mini app. */
const APP_FIELDS = [
  'apiVersion',
  'private',
  'category',
  'surfaces',
  'fileAssociations',
  'views',
  'promptSections',
  'contributions',
] as const

interface InlineArg {
  name: string
  type?: string
}
interface InlineCommand {
  name: string
  description?: string
  prompt: string
  argumentHint?: string
  args?: InlineArg[]
  featured?: boolean
  activateTools?: string[]
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
}

export function splitLegacyManifest(legacy: Record<string, unknown>): SplitManifest {
  const plugin: Record<string, unknown> = {}
  const app: Record<string, unknown> = { name: legacy.name }
  const files: Record<string, string> = {}
  for (const field of PLUGIN_FIELDS) if (legacy[field] !== undefined) plugin[field] = legacy[field]
  if (legacy.author !== undefined)
    plugin.author = typeof legacy.author === 'string' ? { name: legacy.author } : legacy.author
  // The default `skills/` folder is found without a key.
  const skills = legacy.skills
  if (skills !== undefined && skills !== './skills' && skills !== './skills/')
    plugin.skills = skills

  for (const field of APP_FIELDS) if (legacy[field] !== undefined) app[field] = legacy[field]
  if (legacy.tools !== undefined) app.backend = legacy.tools
  if (legacy.monitors !== undefined) plugin.experimental = { monitors: legacy.monitors }

  const commands = Array.isArray(legacy.commands) ? legacy.commands : []
  const paths = commands.filter((entry): entry is string => typeof entry === 'string')
  if (paths.length) plugin.commands = paths
  const options: Record<string, Record<string, unknown>> = {}
  for (const entry of commands) {
    if (typeof entry !== 'object' || entry === null) continue
    const command = entry as InlineCommand
    files[`commands/${command.name.replaceAll(':', '/')}.md`] = commandFile(command)
    const extra = {
      ...(command.args?.length ? { args: command.args } : {}),
      ...(command.featured ? { featured: true } : {}),
      ...(command.activateTools?.length ? { activateTools: command.activateTools } : {}),
    }
    if (Object.keys(extra).length) options[command.name] = extra
  }
  if (Object.keys(options).length) app.commands = options

  const isApp = Object.keys(app).length > 1 || legacy.config !== undefined
  // Settings belong to whoever reads them: the mini app's backend when there is one.
  if (legacy.config !== undefined) app.config = legacy.config
  if (legacy.defaultEnabled !== undefined)
    (isApp ? app : plugin).defaultEnabled = legacy.defaultEnabled

  files[MANIFEST_FILE] = json(plugin)
  if (isApp) files[MINI_APP_MANIFEST_FILE] = json(app)
  return { plugin, app: isApp ? app : null, files }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/** One inline command as `commands/<name>.md`, in Claude Code's frontmatter. */
function commandFile(command: InlineCommand): string {
  const args = command.args ?? []
  // One free-text argument is the whole argument string; otherwise each named one is positional.
  const whole = args.length === 1 && (args[0]!.type ?? 'text') === 'text'
  let body = command.prompt
  for (const arg of args)
    body = body.replaceAll(`\${${arg.name}}`, whole ? '$ARGUMENTS' : `$${arg.name}`)
  const front = [
    ['description', command.description],
    ['argument-hint', command.argumentHint],
    [
      'arguments',
      !whole && args.length ? `[${args.map((arg) => arg.name).join(', ')}]` : undefined,
    ],
    ['model', command.model],
    ['allowed-tools', command.allowedTools?.join(', ')],
    ['disallowed-tools', command.disallowedTools?.join(', ')],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  const yaml = front
    .map(([key, value]) => `${key}: ${key === 'arguments' ? value : yamlScalar(value)}`)
    .join('\n')
  return `---\n${yaml}\n---\n\n${body.trim()}\n`
}

/** A YAML scalar that survives any text: quoted unless it is plainly safe. */
const yamlScalar = (value: string) =>
  /^[\w ./,()-]+$/.test(value) && !value.startsWith('[') ? value : JSON.stringify(value)
