import { BUILTIN_OUTPUT_STYLES } from './output-style-builtins'
import type { DiscoveredPlugin } from './discovery-types'
import { activeStyleId, DEFAULT_OUTPUT_STYLE_ID, offeredStyleIndexes, type StyleBody } from './kit'

/**
 * The output styles a chat can run in, as Claude Code lists them in `/output-style`: the built-in
 * styles, each enabled plugin's, offered as `<plugin>:<name>`, the project's (`.localix/output-styles`
 * and `.claude/output-styles` from the working directory up) and the person's own. The loader hands enabled plugins' styles to each run; the local ones are read
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

/**
 * A plugin's styles, their instructions as written: `${...}` resolves in skill, command and agent
 * content only (plugins/manifest-reference.md, "Where each variable resolves"), and the kit reads a
 * plugin's output style without substitution.
 */
export function pluginOutputStyles(
  plugin: Pick<DiscoveredPlugin, 'manifest' | 'entrypoints'>,
): PluginOutputStyle[] {
  return (plugin.entrypoints.components?.outputStyles ?? []).map((style) => ({
    pluginName: plugin.manifest.name,
    fullName: `${plugin.manifest.name}:${style.name}`,
    source: 'plugin',
    style,
  }))
}

const local = (source: OutputStyleSource, styles: readonly StyleBody[] = []): NamedOutputStyle[] =>
  styles.map((style) => ({ fullName: style.name, source, style }))

/**
 * Every style a chat can pick, in the order `/output-style` lists them, as the kit decides it
 * (`offeredStyleIndexes`): the built-ins, then the custom styles in precedence order (the enabled
 * plugins', the project's nearest first, the person's), the first of a name winning and none
 * shadowing a built-in.
 */
export function outputStyleCatalog(input: {
  plugins?: readonly PluginOutputStyle[]
  user?: readonly StyleBody[]
  project?: readonly StyleBody[]
}): NamedOutputStyle[] {
  const custom = [
    ...(input.plugins ?? []),
    ...local('project', input.project),
    ...local('user', input.user),
  ]
  const offered = offeredStyleIndexes(
    custom.map((entry) => ({ id: entry.fullName, style: entry.style })),
  )
  return [...local('builtin', BUILTIN_OUTPUT_STYLES), ...offered.map((index) => custom[index]!)]
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
 * What `/output-style <query>` names, ignoring case as Claude Code's command does
 * (output-styles.md, "Change your output style"): the default style or a style's full name, a
 * plugin's as `<plugin>:<name>`.
 */
export function findOutputStyle(
  styles: readonly NamedOutputStyle[],
  query: string,
): { kind: 'default' } | { kind: 'style'; entry: NamedOutputStyle } | { kind: 'none' } {
  const wanted = query.trim().toLowerCase()
  if (wanted === DEFAULT_OUTPUT_STYLE_ID) return { kind: 'default' }
  const entry = styles.find((one) => one.fullName.toLowerCase() === wanted)
  return entry ? { kind: 'style', entry } : { kind: 'none' }
}
