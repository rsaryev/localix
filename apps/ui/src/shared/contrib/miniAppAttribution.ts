/**
 * Which plugin is calling — answered from WHERE its code was loaded, never from what it says.
 *
 * Every plugin's UI takes the SDK from the host as one shared module, so one `toast` serves them
 * all and the host could not tell a plugin's row from its own: each read "System", with no plugin
 * name. Asking the plugin to name itself would let any plugin speak as another, and would need
 * every call site changed.
 *
 * The shape is the one editors use to blame an extension for the error it threw: each plugin's UI
 * is imported by URL from its own artifact directory, so a stack frame whose URL lies under that
 * directory is that plugin's code. The first such frame, reading from the innermost call outwards,
 * is the plugin that made the call; host and SDK frames above it are skipped because no plugin was
 * loaded from their URLs.
 *
 * Both stack dialects the product runs on carry the URL verbatim — V8 as
 * `    at fn (URL:line:col)` and JavaScriptCore (the desktop shell's WebKit) as `fn@URL:line:col` —
 * so the match is on the URL prefix inside each line rather than on either grammar.
 */

/** One loaded plugin UI: the directory its artifact is served from, and whose it is. */
export interface PluginUiSource {
  pluginName: string
  /** Absolute URL of the artifact directory, ending in `/`, without a query. */
  base: string
}

export interface PluginCaller {
  pluginName: string
  /** What a person reads: the plugin's display name, or its name when it declares none. */
  label: string
}

let sources: readonly PluginUiSource[] = []
let labels: ReadonlyMap<string, string> = new Map()

/**
 * Replace what the host knows about installed plugins: the display name of each, and the artifact
 * directory of each whose UI it loads. Called with every capability snapshot, so a renamed or
 * removed plugin stops being named here as soon as it stops being loaded.
 */
export function setPluginSources(
  next: readonly PluginUiSource[],
  names: ReadonlyMap<string, string>,
): void {
  // Longest first, so a base that happened to prefix another could never claim its frames.
  sources = [...next].sort((a, b) => b.base.length - a.base.length)
  labels = names
}

/** A plugin's display name, or `name` itself for one the host does not know. */
export function pluginLabel(name: string): string {
  return labels.get(name) || name
}

/** The plugin whose code made the call that produced `stack`, or null when none did. */
export function attributeMiniAppCaller(
  stack: string,
  known: readonly PluginUiSource[] = sources,
): PluginCaller | null {
  if (!known.length) return null
  for (const line of stack.split('\n')) {
    const source = known.find(({ base }) => line.includes(base))
    if (source) return { pluginName: source.pluginName, label: pluginLabel(source.pluginName) }
  }
  return null
}
