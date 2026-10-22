import { DEFAULT_OUTPUT_STYLE, type OutputStyle } from '@localixai/claude-plugin'

import { BUILTIN_OUTPUT_STYLES } from './output-style-builtins'
import type { DiscoveredPlugin } from './discovery-types'

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
  style: OutputStyle
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
    style: { ...style, prompt: subst(style.prompt) },
  }))
}

/**
 * Every style a chat can pick, in the order `/output-style` lists them. A name defined at more
 * than one local level resolves to the nearest: the project's over the person's over a built-in.
 * Plugin styles carry their plugin's prefix, so they never collide with a local one.
 */
export function outputStyleCatalog(input: {
  plugins?: readonly PluginOutputStyle[]
  user?: readonly OutputStyle[]
  project?: readonly OutputStyle[]
}): NamedOutputStyle[] {
  const local = new Map<string, NamedOutputStyle>()
  const offer = (source: OutputStyleSource, styles: readonly OutputStyle[]) => {
    for (const style of styles)
      if (style.name !== DEFAULT_OUTPUT_STYLE)
        local.set(style.name, { fullName: style.name, source, style })
  }
  offer('builtin', BUILTIN_OUTPUT_STYLES)
  offer('user', input.user ?? [])
  offer('project', input.project ?? [])
  return [...local.values(), ...(input.plugins ?? [])]
}

/**
 * The style a chat runs in: a plugin style marked `force-for-plugin` while its plugin is enabled
 * (the first loaded wins, over every choice, as in Claude Code); else the chat's own choice; else,
 * when the chat made none, the person's default (`outputStyle` in Settings). `default` is an
 * explicit choice of no style. A name nothing offers any more — a removed file, a disabled plugin —
 * falls back to the default style, as an unmatched `outputStyle` does in Claude Code.
 */
export function activeOutputStyle(
  styles: readonly NamedOutputStyle[],
  chosen: string | null | undefined,
  fallback?: string | null,
): NamedOutputStyle | null {
  const forced = styles.find((entry) => entry.source === 'plugin' && entry.style.forceForPlugin)
  if (forced) return forced
  const name = chosen || fallback
  if (!name || name === DEFAULT_OUTPUT_STYLE) return null
  return styles.find((entry) => entry.fullName === name) ?? null
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
  if (wanted === DEFAULT_OUTPUT_STYLE) return { kind: 'default' }
  const exact = styles.find((entry) => entry.fullName.toLowerCase() === wanted)
  if (exact) return { kind: 'style', entry: exact }
  const bare = styles.filter(
    (entry) => entry.source === 'plugin' && entry.style.name.toLowerCase() === wanted,
  )
  if (bare.length === 1) return { kind: 'style', entry: bare[0]! }
  return { kind: bare.length > 1 ? 'ambiguous' : 'none' }
}
