import { z } from 'zod'
import { issue, type PluginIssue } from './issues'
import { checkPluginName } from './names'
import { checkComponentPath, isRemoteBundle } from './paths'

/**
 * `.claude-plugin/plugin.json`, as Claude Code documents it. Only `name` is required, and the file
 * itself is optional: without one, the plugin is named after its directory. Component fields name
 * paths relative to the plugin root; `componentSources` (layout.ts) says how each combines with its
 * default location.
 */

const pathOrPaths = z.union([z.string(), z.array(z.string())])
const record = z.record(z.string(), z.unknown())

/** One `userConfig` option. Strict: an unknown key is an error, as in Claude Code. */
export const userConfigOptionSchema = z.strictObject({
  type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
  title: z.string(),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  multiple: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string().min(1).max(64)).optional(),
})
export type UserConfigOption = z.infer<typeof userConfigOptionSchema>

/** One entry of the `commands` object map: `/<plugin>:<key>`, from a file or inline content. */
export const commandEntrySchema = z
  .object({
    source: z.string().optional(),
    content: z.string().optional(),
    description: z.string().optional(),
    argumentHint: z.string().optional(),
    model: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
  })
  .refine((entry) => (entry.source === undefined) !== (entry.content === undefined), {
    message: 'Set exactly one of "source" or "content"',
  })
export type CommandEntry = z.infer<typeof commandEntrySchema>

export const dependencySchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    marketplace: z.string().optional(),
    version: z.string().optional(),
  }),
])
export type PluginDependency = z.infer<typeof dependencySchema>

const authorSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional(),
})

/** Server and LSP fields: a file, an inline map, or a list mixing both. */
const sourceList = z.union([z.string(), record, z.array(z.union([z.string(), record]))])

const FIELDS = {
  $schema: z.string(),
  name: z.string(),
  displayName: z.string(),
  version: z.string(),
  description: z.string(),
  author: authorSchema,
  homepage: z.url(),
  repository: z.string(),
  license: z.string(),
  keywords: z.array(z.string()),
  metadata: record,
  icon: z.string(),
  documentationUrl: z.string(),
  supportUrl: z.string(),
  privacyPolicyUrl: z.string(),
  termsOfServiceUrl: z.string(),
  defaultEnabled: z.boolean(),
  dependencies: z.array(dependencySchema),
  settings: record,
  userConfig: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.unknown()),
  types: z.string(),
  channels: z.array(
    z.strictObject({
      server: z.string(),
      displayName: z.string().optional(),
      userConfig: z.record(z.string(), userConfigOptionSchema).optional(),
    }),
  ),
  skills: pathOrPaths,
  commands: z.union([pathOrPaths, z.record(z.string(), commandEntrySchema)]),
  agents: pathOrPaths,
  hooks: z.union([z.string(), record, z.array(z.union([z.string(), record]))]),
  mcpServers: sourceList,
  lspServers: sourceList,
  outputStyles: pathOrPaths,
  workflows: pathOrPaths,
  themes: pathOrPaths,
  monitors: z.union([z.string(), z.array(z.unknown())]),
  experimental: z.object({
    themes: pathOrPaths.optional(),
    monitors: z.union([z.string(), z.array(z.unknown())]).optional(),
    evals: pathOrPaths.optional(),
  }),
} as const

type Fields = typeof FIELDS
export type ClaudePluginManifest = { name: string } & {
  [K in Exclude<keyof Fields, 'name' | 'userConfig'>]?: z.infer<Fields[K]>
} & { userConfig?: Record<string, UserConfigOption> }

/** Fields that moved under `experimental`: still loaded at the top level, with a warning. */
const MOVED_TO_EXPERIMENTAL = new Set(['themes', 'monitors'])

/** Component fields whose values are paths in the plugin. */
const PATH_FIELDS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
  'outputStyles',
  'workflows',
] as const

export interface ParsedClaudePluginManifest {
  /** Null when the manifest cannot load: not an object, or no usable name. */
  manifest: ClaudePluginManifest | null
  issues: PluginIssue[]
}

const describe = (error: z.ZodError) =>
  error.issues.map((found) => found.message).join('; ') || 'invalid value'

/**
 * Parse a manifest the way Claude Code loads one: an unknown top-level key is dropped with a
 * warning, a field of the wrong shape is dropped with an error, and so is a `userConfig` option
 * that breaks its strict shape; the rest of the plugin still loads. A missing or unusable `name`
 * stops it, unless the caller supplies the directory's name (`fallbackName`).
 */
export function parseClaudePluginManifest(
  raw: unknown,
  options: { fallbackName?: string } = {},
): ParsedClaudePluginManifest {
  const issues: PluginIssue[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      manifest: null,
      issues: [issue('error', 'plugin.json', 'The manifest is not a JSON object')],
    }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const schema = (FIELDS as Record<string, z.ZodType>)[key]
    if (!schema) {
      issues.push(issue('warning', key, `Unknown field "${key}"`))
      continue
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      issues.push(issue('error', key, `Invalid "${key}": ${describe(parsed.error)}`))
      continue
    }
    if (MOVED_TO_EXPERIMENTAL.has(key))
      issues.push(issue('warning', key, `"${key}" belongs under "experimental"`))
    out[key] = parsed.data
  }

  if (out.userConfig)
    out.userConfig = userConfigOf(out.userConfig as Record<string, unknown>, issues)

  const name = typeof out.name === 'string' ? out.name : options.fallbackName
  if (name === undefined) {
    issues.push(issue('error', 'name', 'The manifest has no "name"'))
    return { manifest: null, issues }
  }
  // Loading, not validating: a reserved name loads in Claude Code (Anthropic's own carry one).
  const nameIssues = checkPluginName(name, 'name', { reserved: false })
  issues.push(...nameIssues)
  if (nameIssues.some((found) => found.severity === 'error')) return { manifest: null, issues }
  out.name = name

  for (const field of PATH_FIELDS) issues.push(...pathIssues(field, out[field]))
  return { manifest: out as ClaudePluginManifest, issues }
}

function userConfigOf(
  options: Record<string, unknown>,
  issues: PluginIssue[],
): Record<string, UserConfigOption> {
  const kept: Record<string, UserConfigOption> = {}
  for (const [key, option] of Object.entries(options)) {
    const parsed = userConfigOptionSchema.safeParse(option)
    if (parsed.success) kept[key] = parsed.data
    else
      issues.push(
        issue('error', `userConfig.${key}`, `Invalid option "${key}": ${describe(parsed.error)}`),
      )
  }
  return kept
}

/** Every string path a component field names, inline objects aside. */
function pathsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')
  if (value && typeof value === 'object')
    return Object.values(value).flatMap((entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { source?: unknown }).source === 'string'
        ? [(entry as { source: string }).source]
        : [],
    )
  return []
}

function pathIssues(field: (typeof PATH_FIELDS)[number], value: unknown): PluginIssue[] {
  return pathsIn(value).flatMap((path) => {
    if (field === 'mcpServers' && isRemoteBundle(path)) return []
    const found = checkComponentPath(path, field, { allowRoot: field === 'skills' })
    return found ? [found] : []
  })
}
