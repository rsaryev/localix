import { BUILTIN_OUTPUT_STYLES } from './output-style-builtins'
import type { DiscoveredPlugin } from './discovery-types'
import { activeStyleId, DEFAULT_OUTPUT_STYLE_ID, type StyleBody } from './kit'

/**
 * The output styles a chat can run in, as Claude Code lists them in `/output-style`: the built-in
 * styles, the person's own (`~/.localix/output-styles`), the project's (`.localix/output-styles`
 * from the working directory up to the repository root) and each enabled plugin's, offered as
 * `<plugin>:<name>`. The loader hands enabled plugins' styles to each run; the local ones are read
 * per run (`output-style-files.ts`); `/output-style` and the run both resolve through here.
 */
export type OutputStyleSource = 'builtin' | 'user' | 'project' | 'plugin'

export interface NamedOutputStyle {
  /** What a chat or a setting stores: the style's name, or `<plugin>:<name>` for a plugin's. */
  fullName: string
  source: OutputStyleSource
  style: StyleBody
  pluginName?: string
}

export interface PluginOutputStyle extends NamedOutputStyle {
  source: 'plugin'
  pluginName: string
}

/** A plugin's styles, their instructions passed through `subst` (path and config variables). */
export function pluginOutputStyles(
  plugin: Pick<DiscoveredPlugin, 'manifest' | 'entrypoints'>,
  subst: (text: string) => string = (text) => text,
): PluginOutputStyle[] {
  return (plugin.entrypoints.components?.outputStyles ?? []).map((style) => ({
    pluginName: plugin.manifest.name,
    fullName: `${plugin.manifest.name}:${style.name}`,
    source: 'plugin',
    style: { ...style, instructions: subst(style.instructions) },
  }))
}

/**
 * Every style a chat can pick, in the order `/output-style` lists them. A name defined at more
 * than one local level resolves to the nearest: the project's over the person's over a built-in.
 * Plugin styles carry their plugin's prefix, so they never collide with a local one.
 */
export function outputStyleCatalog(input: {
  plugins?: readonly PluginOutputStyle[]
  user?: readonly StyleBody[]
  project?: readonly StyleBody[]
}): NamedOutputStyle[] {
  const local = new Map<string, NamedOutputStyle>()
  const offer = (source: OutputStyleSource, styles: readonly StyleBody[]) => {
    for (const style of styles)
      if (style.name !== DEFAULT_OUTPUT_STYLE_ID)
        local.set(style.name, { fullName: style.name, source, style })
  }
  offer('builtin', BUILTIN_OUTPUT_STYLES)
  offer('user', input.user ?? [])
  offer('project', input.project ?? [])
  return [...local.values(), ...(input.plugins ?? [])]
}

/**
 * The style a chat runs in, as the kit resolves it (`activeStyleId`): a plugin style marked
 * `force-for-plugin` while its plugin is enabled (the first loaded wins), else the chat's own choice
 * (`chosen`, as `/output-style` set it), else the person's default (`fallback`: `outputStyle` in
 * Settings, or Claude Code's). `default`, or a name nothing offers any more (a removed file, a
 * disabled plugin), is no style.
 */
export function activeOutputStyle(
  styles: readonly NamedOutputStyle[],
  chosen: string | null | undefined,
  fallback?: string | null,
): NamedOutputStyle | null {
  const id = activeStyleId(
    styles.map((entry) => ({ id: entry.fullName, style: entry.style })),
    { ...(chosen ? { command: chosen } : {}), ...(fallback ? { setting: fallback } : {}) },
  )
  return styles.find((entry) => entry.fullName === id) ?? null
}

/**
 * What `/output-style <query>` names, ignoring case as Claude Code's command does: the default
 * style, a style's full name, or a bare name only one plugin offers.
 */
export function findOutputStyle(
  styles: readonly NamedOutputStyle[],
  query: string,
):
  | { kind: 'default' }
  | { kind: 'style'; entry: NamedOutputStyle }
  | { kind: 'none' | 'ambiguous' } {
  const wanted = query.trim().toLowerCase()
  if (wanted === DEFAULT_OUTPUT_STYLE_ID) return { kind: 'default' }
  const exact = styles.find((entry) => entry.fullName.toLowerCase() === wanted)
  if (exact) return { kind: 'style', entry: exact }
  const bare = styles.filter(
    (entry) => entry.source === 'plugin' && entry.style.name.toLowerCase() === wanted,
  )
  if (bare.length === 1) return { kind: 'style', entry: bare[0]! }
  return { kind: bare.length > 1 ? 'ambiguous' : 'none' }
}
