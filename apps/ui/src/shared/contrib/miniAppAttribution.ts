/**
 * Which mini app is calling — answered from WHERE its code was loaded, never from what it says.
 *
 * Every mini app's UI takes the SDK from the host as one shared module, so one `toast` serves them
 * all and the host could not tell a mini app's row from its own: each read "System", with no mini
 * app name. Asking the mini app to name itself would let any mini app speak as another, and would
 * need every call site changed.
 *
 * The shape is the one editors use to blame an extension for the error it threw: each mini app's UI
 * is imported by URL from its own artifact directory, so a stack frame whose URL lies under that
 * directory is that mini app's code. The first such frame, reading from the innermost call
 * outwards, is the mini app that made the call; host and SDK frames above it are skipped because no
 * mini app was loaded from their URLs.
 *
 * Both stack dialects the product runs on carry the URL verbatim — V8 as
 * `    at fn (URL:line:col)` and JavaScriptCore (the desktop shell's WebKit) as `fn@URL:line:col` —
 * so the match is on the URL prefix inside each line rather than on either grammar.
 */

/** One loaded mini app UI: the directory its artifact is served from, and whose it is. */
export interface MiniAppUiSource {
  miniAppName: string
  /** Absolute URL of the artifact directory, ending in `/`, without a query. */
  base: string
}

export interface MiniAppCaller {
  miniAppName: string
  /** What a person reads: the mini app's display name, or its name when it declares none. */
  label: string
}

let sources: readonly MiniAppUiSource[] = []
let labels: ReadonlyMap<string, string> = new Map()

/**
 * Replace what the host knows about installed mini apps: the display name of each, and the artifact
 * directory of each whose UI it loads. Called with every capability snapshot, so a renamed or
 * removed mini app stops being named here as soon as it stops being loaded.
 */
export function setMiniAppSources(
  next: readonly MiniAppUiSource[],
  names: ReadonlyMap<string, string>,
): void {
  // Longest first, so a base that happened to prefix another could never claim its frames.
  sources = [...next].sort((a, b) => b.base.length - a.base.length)
  labels = names
}

/** A mini app's display name, or `name` itself for one the host does not know. */
export function miniAppLabel(name: string): string {
  return labels.get(name) || name
}

/** The mini app whose code made the call that produced `stack`, or null when none did. */
export function attributeMiniAppCaller(
  stack: string,
  known: readonly MiniAppUiSource[] = sources,
): MiniAppCaller | null {
  if (!known.length) return null
  for (const line of stack.split('\n')) {
    const source = known.find(({ base }) => line.includes(base))
    if (source) return { miniAppName: source.miniAppName, label: miniAppLabel(source.miniAppName) }
  }
  return null
}
