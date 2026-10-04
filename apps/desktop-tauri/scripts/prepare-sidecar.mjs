// Stage everything the packaged Tauri app needs to resolve/start the shared API
// daemon through a one-shot sidecar launcher (a real `bun.exe` running a
// bundled `server.js`, NOT `bun build --compile` — the compiled single-file
// binary can't resolve the migrations' external `import 'kysely'`).
//
// Produces (under src-tauri/):
//   binaries/bun-<triple>.exe   the native Bun runtime (Tauri sidecar)
//   resources/server.js         the API bundled to one JS file
//   resources/migrations/       migration .ts files + vendored node_modules/kysely
//   resources/plugins/          bundled plugins (self-contained .mjs; a .ts backend
//                               entry is PRE-BUNDLED from the repo tree — see step 3)
//   resources/plugin-kit/       what the app needs to create, build and test USER plugins
//                               (template, shared-module exports, theme stylesheets)
//
// Pass --ui to ALSO build apps/ui into apps/ui/dist (the prod frontendDist).
// Run by tauri's beforeDev/BuildCommand; also runnable by hand.
import {
  cpSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { stageSidecarBun, binariesDir, resourcesDir as resources } from './tauri-staging.mjs'
import {
  STAGED_DROPINS_MARKER,
  stageDropins,
  stagePluginKitBeside,
} from '../../../scripts/stage-dropins.mjs'
import { PLUGIN_KIT_INPUTS } from '../../../scripts/stage-plugin-kit.mjs'
import { BUILD_STAMP_ENV, resolveBuildStamp } from '../../../scripts/build-stamp.mjs'
import {
  buildVisualFeedbackProbe,
  buildNativeBrowserProbe,
} from '../../../scripts/build-visual-feedback-probe.mjs'
import {
  STAGED_THIRD_PARTY_NOTICE_FILES,
  stageThirdPartyNotices,
} from '../../../scripts/stage-third-party-notices.mjs'
import { buildStagedCliPackageMetadata } from './cli-package-metadata.mjs'
import {
  PARCEL_WATCHER_ADDONS,
  hostWatcherAddon,
} from '../../api/src/features/fs-watch/native-binding.ts'

const here = dirname(fileURLToPath(import.meta.url)) // apps/desktop-tauri/scripts
const desktop = resolve(here, '..') // apps/desktop-tauri
const repo = resolve(desktop, '..', '..') // repo root
const buildUi = process.argv.includes('--ui')
const tauriConfigFile = join(desktop, 'src-tauri', 'tauri.conf.json')
const stagedCliPackage = buildStagedCliPackageMetadata(
  JSON.parse(readFileSync(tauriConfigFile, 'utf8')),
)

const log = (...a) => console.log('[prepare-sidecar]', ...a)

// Packaging inputs are large, but their metadata is cheap to scan. Keep the
// expensive API/plugin bundle and UI type-check/build independent so a Rust-
// only rebuild reuses both staged layers. The cache lives under Cargo target and
// therefore disappears naturally on `cargo clean`.
const cacheFile = join(desktop, 'src-tauri', 'target', 'localix-prepare-cache.json')
const skippedDirs = new Set(['node_modules', 'dist', 'target', '.turbo', '.git'])
function fingerprint(paths, extra = []) {
  const hash = createHash('sha256')
  const visit = (path) => {
    if (!existsSync(path)) return
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (!skippedDirs.has(entry)) visit(join(path, entry))
      }
      return
    }
    hash.update(path.slice(repo.length))
    hash.update(`${stat.size}:${stat.mtimeMs}`)
  }
  for (const path of paths) visit(path)
  for (const value of extra) hash.update(`extra:${value}`)
  hash.update(`${process.platform}:${process.arch}:${Bun.version}`)
  return hash.digest('hex')
}
// Resolved ONCE and handed to the UI build, so the cache key below and the `__UI_BUILD__` the
// bundle reports are the same value. They used to be two copies of the git rule, and both
// counted the release workflow's own version stamping as `-dirty`.
const buildStamp = resolveBuildStamp({ cwd: repo })
const readCache = () => {
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'))
  } catch {
    return {}
  }
}
const cache = readCache()
const runtimeKey = fingerprint([
  join(repo, 'apps', 'api'),
  join(repo, 'packages'),
  join(repo, 'plugins'),
  join(repo, 'vendor', 'pi', 'packages'),
  join(desktop, 'scripts'),
  join(repo, 'scripts', 'build-visual-feedback-probe.mjs'),
  join(repo, 'scripts', 'stage-dropins.mjs'),
  join(repo, 'scripts', 'stage-plugin-ui.mjs'),
  join(repo, 'scripts', 'build-plugin-ui.mjs'),
  // Everything the plugin kit is made from — the same list the dev watcher re-stages on.
  ...PLUGIN_KIT_INPUTS.map((input) => join(repo, input)),
  join(repo, 'scripts', 'stage-third-party-notices.mjs'),
  join(repo, 'vendor', 'pi', 'LICENSE'),
  join(repo, 'vendor', 'monaco-editor-runtime'),
  join(repo, 'bun.lock'),
  join(repo, 'LICENSE'),
  join(repo, 'tsconfig.base.json'),
  tauriConfigFile,
  fileURLToPath(import.meta.url),
])
const runtimeReady =
  cache.runtime === runtimeKey &&
  existsSync(join(resources, 'server.js')) &&
  existsSync(join(resources, 'visual-feedback-probe.js')) &&
  existsSync(join(resources, 'visual-feedback-native-probe.js')) &&
  existsSync(join(resources, 'migrations', '20260601T000000_init_schema.ts')) &&
  existsSync(join(resources, 'plugins', STAGED_DROPINS_MARKER)) &&
  existsSync(join(resources, 'plugin-kit', 'kit.json')) &&
  existsSync(join(resources, 'cli', 'server', 'cli.js')) &&
  existsSync(join(resources, 'cli', 'package.json')) &&
  existsSync(join(resources, 'LICENSE')) &&
  STAGED_THIRD_PARTY_NOTICE_FILES.every((filename) =>
    existsSync(join(resources, 'THIRD_PARTY_NOTICES', filename)),
  ) &&
  existsSync(stageSidecarBun().path)

// ── clean + recreate ──────────────────────────────────────────────────────────
if (!runtimeReady) {
  rmSync(resources, { recursive: true, force: true })
  mkdirSync(resources, { recursive: true })
  mkdirSync(binariesDir, { recursive: true })
  copyFileSync(join(repo, 'LICENSE'), join(resources, 'LICENSE'))
  stageThirdPartyNotices({
    repoRoot: repo,
    destination: join(resources, 'THIRD_PARTY_NOTICES'),
  })

  // ── 1. bundle the API to resources/server.js (external migrations/plugins stay
  //       on disk). Use --outdir (not --outfile) so bun can also emit the native
  //       required `.node` addons it references beside server.js — --outfile refuses
  //       multiple outputs. Optional plugin-native accelerators are handled by the
  //       shared stageDropins bundler below.
  //       --entry-naming pins the entry filename to server.js.
  //       Minified for whitespace and syntax only: unminified, server.js was 13.9 MB parsed on
  //       every launch; identifiers stay so a crash report's stack still names the function. ──
  const apiEntry = join(repo, 'apps', 'api', 'src', 'index.ts')
  const serverOut = join(resources, 'server.js')
  // The file-tree watcher's native addon: bun copies the HOST platform's `.node` beside
  // server.js; every other platform's static require is left external, because only the
  // host's optional package is installed (see fs-watch/native-binding.ts).
  const hostAddon = hostWatcherAddon()
  if (!hostAddon) log(`warning: no native file watcher for ${process.platform}-${process.arch}`)
  const watcherExternals = PARCEL_WATCHER_ADDONS.filter((addon) => addon !== hostAddon).flatMap(
    (addon) => ['--external', addon],
  )
  log('bundling API →', serverOut)
  execFileSync(
    'bun',
    [
      'build',
      apiEntry,
      '--target=bun',
      '--outdir',
      resources,
      '--entry-naming',
      'server.js',
      '--minify-syntax',
      '--minify-whitespace',
      ...watcherExternals,
    ],
    { stdio: 'inherit' },
  )
  buildVisualFeedbackProbe({
    repoRoot: repo,
    outFile: join(resources, 'visual-feedback-probe.js'),
    log,
  })
  buildNativeBrowserProbe({
    repoRoot: repo,
    outFile: join(resources, 'visual-feedback-native-probe.js'),
    log,
  })

  // ── 2. migrations + vendored kysely (migration .ts files `import 'kysely'` at
  //       runtime and resolve it from an ADJACENT node_modules) ──────────────────
  const migOut = join(resources, 'migrations')
  mkdirSync(join(migOut, 'node_modules'), { recursive: true })
  cpSync(join(repo, 'apps', 'api', 'migrations'), migOut, { recursive: true })
  cpSync(join(repo, 'node_modules', 'kysely'), join(migOut, 'node_modules', 'kysely'), {
    recursive: true,
  })
  log('staged migrations + vendored kysely')

  // ── 3. bundled plugins ─────────────────────────────────────────────────────────
  // The shared stage-dropins script copies the plugin tree (stripping dev-only files
  // and the template skeleton) and pre-bundles every TS-backend workbench plugin FROM
  // THE REPO TREE (where its workspace deps resolve), repointing staged manifests —
  // without it the packaged app's contributed backends failed to load.
  // The plugin kit first: the plugin UI builds read it, and the installed app needs it to
  // create and build the user's own plugins without a source tree.
  stagePluginKitBeside({ repoRoot: repo, outPlugins: join(resources, 'plugins') })
  stageDropins({
    repoRoot: repo,
    outPlugins: join(resources, 'plugins'),
    log,
    // First-party plugin UIs are not debugged on a user's machine; their maps were 17 MB.
    uiSourceMaps: false,
  })

  // ── 3b. the `localix` CLI, staged INSIDE the bundle (no separate CLI product) ──
  // The shim (bin/localix.mjs) + the launcher bundle it imports (runCli). lib.rs points
  // LOCALIX_CLI_ENTRY at the shim so the shell-command install execs it under the
  // sidecar Bun — that's how `localix .` / `localix <path>` reach the running app.
  // Layout mirrors packages/cli so the shim's own path math resolves:
  //   resources/cli/bin/localix.mjs   → shim (PKG_ROOT = resources/cli)
  //   resources/cli/server/cli.js     → launcher bundle (CLI_BUNDLE = PKG_ROOT/server/cli.js)
  const cliOut = join(resources, 'cli')
  mkdirSync(join(cliOut, 'bin'), { recursive: true })
  mkdirSync(join(cliOut, 'server'), { recursive: true })
  copyFileSync(
    join(repo, 'packages', 'cli', 'bin', 'localix.mjs'),
    join(cliOut, 'bin', 'localix.mjs'),
  )
  writeFileSync(join(cliOut, 'package.json'), `${JSON.stringify(stagedCliPackage, null, 2)}\n`)
  // Bundle the CLI entry DIRECTLY (cli/main.ts), NOT the barrel index.ts — bun's
  // bundler tree-shakes a re-export-only barrel down to an empty module, so the shim
  // would import an undefined `runCli`. cli/main.ts exports runCli, which is all the
  // shim needs.
  execFileSync(
    'bun',
    [
      'build',
      join(repo, 'packages', 'cli', 'src', 'main.ts'),
      '--target=bun',
      '--outfile',
      join(cliOut, 'server', 'cli.js'),
    ],
    { stdio: 'inherit' },
  )
  log('staged localix CLI (shim + launcher bundle)')

  // ── 4. the native Bun runtime as the Tauri sidecar (see tauri-staging.mjs) ───────
  // `force` because a packaging run must always restage, even if a gate run left one here.
  const { path: bunDst } = stageSidecarBun({ force: true })
  log('staged sidecar', basename(bunDst))
  cache.runtime = runtimeKey
} else {
  log('runtime inputs unchanged — reusing staged API, plugins, CLI and Bun')
}

// Tauri signs its main executable and declared sidecars, but native modules copied
// as resources are nested code and must carry their own signature. Local builds use
// an ad-hoc identity; release builds opt into Developer ID through the environment.
if (buildUi && process.platform === 'darwin') {
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '-'

  const nativeResources = []
  const collectNativeResources = (path) => {
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) collectNativeResources(join(path, entry))
    } else if (path.endsWith('.node') || path.endsWith('.dylib')) {
      nativeResources.push(path)
    }
  }
  collectNativeResources(resources)
  for (const path of nativeResources) {
    const args = ['--force', '--options', 'runtime']
    if (identity !== '-') args.push('--timestamp')
    args.push('--sign', identity, path)
    execFileSync('codesign', args, { stdio: 'inherit' })
  }
  if (nativeResources.length > 0) {
    const kind = identity === '-' ? 'ad-hoc signed' : 'Developer ID signed'
    log(`${kind} ${nativeResources.length} native resource(s)`)
  }
}

// ── 5. (prod) build the UI into apps/ui/dist (frontendDist) ─────────────────────
if (buildUi) {
  const uiKey = fingerprint(
    [
      join(repo, 'apps', 'ui'),
      join(repo, 'apps', 'api'),
      join(repo, 'packages'),
      join(repo, 'plugins'),
      join(repo, 'vendor', 'monaco-editor-runtime'),
      join(repo, 'bun.lock'),
      join(repo, 'tsconfig.base.json'),
    ],
    [buildStamp],
  )
  const uiReady = cache.ui === uiKey && existsSync(join(repo, 'apps', 'ui', 'dist', 'index.html'))
  if (!uiReady) {
    log('building UI (apps/ui)…')
    execFileSync('bun', ['run', 'build'], {
      cwd: join(repo, 'apps', 'ui'),
      env: { ...process.env, [BUILD_STAMP_ENV]: buildStamp },
      stdio: 'inherit',
    })
    cache.ui = uiKey
  } else {
    log('UI inputs unchanged — reusing apps/ui/dist')
  }
  if (!existsSync(join(repo, 'apps', 'ui', 'dist', 'index.html'))) {
    throw new Error('UI build did not produce apps/ui/dist/index.html')
  }
  log('UI ready')
}

mkdirSync(dirname(cacheFile), { recursive: true })
writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`)

log('done.')
