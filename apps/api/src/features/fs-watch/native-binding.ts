import type { AsyncSubscription, Event, Options, SubscribeCallback } from '@parcel/watcher'

/**
 * The native recursive watcher (`@parcel/watcher`: FSEvents on macOS, inotify on Linux,
 * ReadDirectoryChangesW on Windows).
 *
 * Loaded HERE, not through the package's `index.js`, because that entry picks its platform addon
 * with `require(\`@parcel/watcher-${platform}-${arch}\`)` — a computed specifier the bundler cannot
 * follow. The packaged sidecar is one bundled `server.js` with no `node_modules` beside it, so a
 * computed require there resolves to nothing (in dev it only appears to work because Bun
 * auto-installs from its cache). Static specifiers, one per platform, are what `bun build` copies
 * beside `server.js`; `prepare-sidecar.mjs` marks every OTHER platform's addon external so a build
 * only needs the addon of the platform it targets — the same shape other native bindings use.
 */
export const PARCEL_WATCHER_ADDONS = [
  '@parcel/watcher-darwin-arm64/watcher.node',
  '@parcel/watcher-darwin-x64/watcher.node',
  '@parcel/watcher-linux-x64-glibc/watcher.node',
  '@parcel/watcher-linux-x64-musl/watcher.node',
  '@parcel/watcher-linux-arm64-glibc/watcher.node',
  '@parcel/watcher-linux-arm64-musl/watcher.node',
  '@parcel/watcher-win32-x64/watcher.node',
  '@parcel/watcher-win32-arm64/watcher.node',
] as const

export interface NativeWatcher {
  subscribe(dir: string, fn: SubscribeCallback, opts?: Options): Promise<AsyncSubscription>
}
export type { AsyncSubscription, Event as NativeWatchEvent }

function isMusl(): boolean {
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } }
    return !report?.header?.glibcVersionRuntime
  } catch {
    return false
  }
}

/**
 * The addon this process's platform loads, as listed above — what the sidecar build must keep
 * (every other entry is marked external). `undefined` on a platform without one.
 */
export function hostWatcherAddon(): string | undefined {
  const libc = process.platform === 'linux' ? (isMusl() ? '-musl' : '-glibc') : ''
  const wanted = `@parcel/watcher-${process.platform}-${process.arch}${libc}/watcher.node`
  return PARCEL_WATCHER_ADDONS.find((addon) => addon === wanted)
}

/* oxlint-disable typescript/no-require-imports -- a native addon is only reachable through require */
function requireAddon(): unknown {
  const musl = process.platform === 'linux' && isMusl()
  switch (`${process.platform}-${process.arch}`) {
    case 'darwin-arm64':
      return require('@parcel/watcher-darwin-arm64/watcher.node')
    case 'darwin-x64':
      return require('@parcel/watcher-darwin-x64/watcher.node')
    case 'linux-x64':
      return musl
        ? require('@parcel/watcher-linux-x64-musl/watcher.node')
        : require('@parcel/watcher-linux-x64-glibc/watcher.node')
    case 'linux-arm64':
      return musl
        ? require('@parcel/watcher-linux-arm64-musl/watcher.node')
        : require('@parcel/watcher-linux-arm64-glibc/watcher.node')
    case 'win32-x64':
      return require('@parcel/watcher-win32-x64/watcher.node')
    case 'win32-arm64':
      return require('@parcel/watcher-win32-arm64/watcher.node')
    default:
      throw new Error(`no native file watcher for ${process.platform}-${process.arch}`)
  }
}

let loaded: NativeWatcher | Error | undefined

/**
 * The watcher, or the reason there is none (an unsupported platform, a missing addon). Loaded once
 * and lazily: a server that never opens a file tree never maps the addon, and a load failure is
 * reported to the caller instead of failing boot.
 */
export function loadNativeWatcher(): NativeWatcher | Error {
  if (loaded) return loaded
  try {
    const { createWrapper } = require('@parcel/watcher/wrapper') as {
      createWrapper: (binding: unknown) => NativeWatcher
    }
    loaded = createWrapper(requireAddon())
  } catch (err) {
    loaded = err instanceof Error ? err : new Error(String(err))
  }
  return loaded
}
/* oxlint-enable typescript/no-require-imports */
