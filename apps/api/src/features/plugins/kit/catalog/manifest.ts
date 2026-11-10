import type { PluginManifest as KitManifest, UserConfigOption } from '@rsaryev/llx-plugin/format'
import { pluginManifestSchema, type PluginManifest } from '../../contracts'
import { schemaIssue } from '../../contracts-base'

/**
 * The manifest Localix keeps for a plugin the kit loaded: what its screens and installs read (name,
 * version, description, author as text, `userConfig` and the channels' options as `config`). Paths
 * and components are the kit's: they are not copied here.
 */

/** A `userConfig` option as a Localix setting: `sensitive` is `secret`, a list default its JSON. */
function settingOf(option: UserConfigOption): Record<string, unknown> {
  const { sensitive, default: fallback, ...rest } = option
  return {
    ...rest,
    ...(sensitive ? { secret: true } : {}),
    ...(fallback === undefined
      ? {}
      : { default: Array.isArray(fallback) ? JSON.stringify(fallback) : fallback }),
  }
}

const settingsOf = (options: Readonly<Record<string, UserConfigOption>>) =>
  Object.fromEntries(Object.entries(options).map(([key, option]) => [key, settingOf(option)]))

/** A channel's options join the plugin's, the plugin's own winning a shared key. */
function configOf(manifest: KitManifest): Record<string, unknown> | undefined {
  const channels = Object.assign({}, ...(manifest.channels ?? []).map((c) => c.userConfig ?? {}))
  const config = { ...settingsOf(channels), ...settingsOf(manifest.userConfig ?? {}) }
  return Object.keys(config).length ? config : undefined
}

/** `"name@marketplace"` keeps the marketplace the dependency resolves in. */
const dependenciesOf = (dependencies: KitManifest['dependencies']) =>
  dependencies?.map((dependency) => {
    if (typeof dependency !== 'string') return dependency
    const [name, marketplace] = dependency.split('@')
    return marketplace ? { name, marketplace } : name
  })

export interface MappedManifest {
  readonly manifest: PluginManifest
  readonly error?: string
}

/**
 * The Localix manifest of a plugin named `name`, from the kit's (absent without a `plugin.json`);
 * one Localix cannot key by is the error, the plugin kept under `fallbackName`.
 */
export function localixManifest(
  name: string,
  kit: KitManifest | undefined,
  fallbackName: string,
): MappedManifest {
  const fields = kit
    ? {
        name,
        origin: { format: 'claude-code' },
        version: kit.version,
        description: kit.description,
        displayName: kit.displayName,
        author: kit.author,
        homepage: kit.homepage,
        repository: kit.repository,
        license: kit.license,
        keywords: kit.keywords,
        defaultEnabled: kit.defaultEnabled,
        dependencies: dependenciesOf(kit.dependencies),
        config: configOf(kit),
      }
    : { name }
  const parsed = pluginManifestSchema.safeParse(fields)
  if (parsed.success) return { manifest: parsed.data }
  return {
    manifest: { name: fallbackName, version: '0.0.0', description: '' },
    error: `Invalid manifest: ${schemaIssue(parsed.error)}`,
  }
}
