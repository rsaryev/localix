import { realpathSync } from 'node:fs'

import { isAtOrUnder } from './path-containment'

/**
 * The environment a user-facing child gets when Localix runs from an AppImage.
 *
 * The AppImage runtime and its AppRun hooks (linuxdeploy's GTK and GStreamer plugins, which
 * Tauri's bundler ships) export variables that point INTO the transient `/tmp/.mount_*`
 * squashfs mount so the BUNDLED GTK/WebKit can find its libraries: `LD_LIBRARY_PATH`,
 * `GDK_PIXBUF_MODULE_FILE`, `GIO_MODULE_DIR`, `GST_PLUGIN_SYSTEM_PATH`, `GTK_PATH`,
 * `PYTHONHOME`, extra `XDG_DATA_DIRS` and `PATH` entries, and more. Every process the API
 * starts inherited them — the user's shell, their dev server, `git`, a Python venv — so a
 * host program loaded the bundle's libraries instead of its own (symbol errors, crashes,
 * TLS failures) or kept paths that dangle the moment the app quits.
 *
 * The shape is taken from Macro-Deck's `environment_outside` (and Amethyst Mod Manager's
 * `strip_appimage_vars`), and it is VALUE-based on purpose: rather than a list of names that
 * goes stale with every AppRun hook, any value — or any `:`-separated entry of a list value
 * — that lies under the mount root is the runtime's, and is removed. A list keeps its host
 * entries; a variable left with nothing is dropped. The runtime's own markers (`APPDIR`,
 * `APPIMAGE`, `ARGV0`, `OWD`) go too, so a child does not believe it runs inside the bundle.
 *
 * A no-op outside an AppImage: with no `APPDIR`, nothing points into a mount.
 */

const RUNTIME_MARKERS = new Set(['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'])

function trimSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

/** The mount root as given, and canonicalized when that differs. */
function bundleRoots(appdir: string): string[] {
  const roots = [trimSlashes(appdir)]
  try {
    const canonical = trimSlashes(realpathSync(appdir))
    if (canonical !== roots[0]) roots.push(canonical)
  } catch {
    /* a mount that is already gone still names its own root */
  }
  return roots.filter(Boolean)
}

// Lexical on purpose: most values are not paths (`DISPLAY=:0`, `GTK_THEME=Adwaita:dark`), and
// resolving one against a cwd inside the mount would make it look bundled.
const underRoot = (entry: string, roots: readonly string[]) =>
  roots.some((root) => isAtOrUnder(root, entry, '/'))

/**
 * `env` without what the AppImage runtime injected. `source` names where `APPDIR` is read
 * from — the API's own environment, which is the one the runtime actually wrote.
 */
export function withoutAppImageEnv(
  env: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const appdir = source.APPDIR
  if (!appdir || !appdir.startsWith('/')) return env
  const roots = bundleRoots(appdir)
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (RUNTIME_MARKERS.has(name) || value === undefined) continue
    const entries = value.split(':')
    if (!entries.some((entry) => underRoot(entry, roots))) {
      out[name] = value
      continue
    }
    const kept = entries.filter((entry) => entry !== '' && !underRoot(entry, roots))
    if (kept.length) out[name] = kept.join(':')
  }
  return out
}
