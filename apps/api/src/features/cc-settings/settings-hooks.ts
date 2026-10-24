import { isRecord } from '../../lib/record'
import type { SettingsLayer } from './settings-files'

/**
 * THE `hooks` OF CLAUDE CODE'S SETTINGS FILES, and which hooks may run at all (hooks.md;
 * settings-reference.md, `disableAllHooks`, `allowManagedHooksOnly`):
 *
 *   - the person's own and the organization's `hooks` run; a project's (`.claude/settings.json`,
 *     `.claude/settings.local.json`) once the folder is trusted, as Claude Code holds them;
 *   - `disableAllHooks` in managed settings turns every hook off, plugins' included; outside
 *     them it turns off every hook but the organization's;
 *   - `allowManagedHooksOnly` keeps the organization's hooks and those of the plugins its
 *     `enabledPlugins` force-enables.
 */
export interface SettingsHooks {
  /** The hooks blocks to load, with the scope each came from. */
  blocks: Array<{ source: 'user' | 'project' | 'local'; raw: unknown; managed: boolean }>
  /** Whether a plugin's hooks may run (`<name>@<marketplace>` or the bare name). */
  pluginAllowed(pluginId: string): boolean
  /** Whether a skill's or an agent's frontmatter hooks may run. */
  frontmatterAllowed: boolean
  /** `allowedHttpHookUrls` and `httpHookAllowedEnvVars`, each merged across the files. */
  http: { allowedUrls?: string[]; allowedEnvVars?: string[] }
}

/** A list key's entries from every layer that sets it, or undefined when none does. */
function mergedList(layers: readonly SettingsLayer[], key: string): string[] | undefined {
  const lists = layers
    .map((layer) => layer.settings[key])
    .filter((value): value is unknown[] => Array.isArray(value))
  if (!lists.length) return undefined
  return [...new Set(lists.flat().filter((entry): entry is string => typeof entry === 'string'))]
}

export function settingsHooks(
  layers: readonly SettingsLayer[],
  options: { projectTrusted: boolean },
): SettingsHooks {
  const managed = layers.filter((l) => l.source === 'policy')
  if (managed.some((l) => l.settings.disableAllHooks === true))
    return { blocks: [], pluginAllowed: () => false, frontmatterAllowed: false, http: {} }
  const managedOnly =
    managed.some((l) => l.settings.allowManagedHooksOnly === true) ||
    layers.some((l) => l.source !== 'policy' && l.settings.disableAllHooks === true)
  const forced = new Set(
    managed.flatMap((l) =>
      isRecord(l.settings.enabledPlugins)
        ? Object.entries(l.settings.enabledPlugins)
            .filter(([, on]) => on === true)
            .map(([id]) => id)
        : [],
    ),
  )
  const blocks: SettingsHooks['blocks'] = []
  for (const layer of layers) {
    if (!isRecord(layer.settings.hooks)) continue
    const isManaged = layer.source === 'policy'
    if (managedOnly && !isManaged) continue
    const repository = layer.source === 'project' || layer.source === 'local'
    if (repository && !options.projectTrusted) continue
    // A managed hook reads as a user one: Localix's sources name where a person writes hooks.
    const source = layer.source === 'project' || layer.source === 'local' ? layer.source : 'user'
    blocks.push({ source, raw: { hooks: layer.settings.hooks }, managed: isManaged })
  }
  const allowedUrls = mergedList(layers, 'allowedHttpHookUrls')
  const allowedEnvVars = mergedList(layers, 'httpHookAllowedEnvVars')
  return {
    blocks,
    http: {
      ...(allowedUrls ? { allowedUrls } : {}),
      ...(allowedEnvVars ? { allowedEnvVars } : {}),
    },
    // `allowManagedHooksOnly` blocks "hooks declared in agent frontmatter" with the rest.
    frontmatterAllowed: !managedOnly,
    pluginAllowed: (pluginId) =>
      !managedOnly ||
      forced.has(pluginId) ||
      [...forced].some((id) => id.slice(0, id.lastIndexOf('@')) === pluginId),
  }
}
