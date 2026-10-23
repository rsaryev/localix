// Stage everything the packaged Tauri app needs to resolve/start the shared API
// daemon through a one-shot sidecar launcher (a real `bun.exe` running a
// bundled `server.js`, NOT `bun build --compile`: the app also runs Bun itself, to build and
// run the user's own mini apps, so the runtime ships as a real binary either way).
//
// Produces (under src-tauri/):
//   binaries/bun-<triple>.exe   the native Bun runtime (Tauri sidecar)
//   resources/server.js         the API bundled to one JS file, migrations and `kysely` included
//   resources/mini-app-kit/     what the app needs to create, build and test USER mini apps
//                               (template, shared-module exports, theme stylesheets)
//
// Pass --ui to ALSO build apps/ui into apps/ui/dist (the prod frontendDist).
// Run by tauri's beforeDev/BuildCommand; also runnable by hand.
import {
  mkdirSync,
  rmSync,
  copyFileSync,
  cpSync,
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
import { createRequire } from 'node:module'
import {
  SCRIPT_EXTENSION_FILES,
  SCRIPT_WASM_FILE,
  SCRIPT_WORKER_FILE,
} from '../../../packages/engine-scripts/src/assets.ts'
import {
  MOD_RUNTIME_FILE,
  buildModRuntime,
} from '../../api/src/features/mods/isolation/guest-file.ts'
import {
  stageSidecarBun,
  binariesDir,
  hostTriple,
  resourcesDir as resources,
} from './tauri-staging.mjs'
import { stageMiniAppKitBeside } from '../../../scripts/stage-dropins.mjs'
import { MINI_APP_KIT_INPUTS } from '../../../scripts/stage-mini-app-kit.mjs'
import { BUNDLED_DIRS, STAGED_APPS_DIR } from '../../../scripts/lib/bundled-roots.mjs'
import { BUILD_STAMP_ENV, resolveBuildStamp } from '../../../scripts/build-stamp.mjs'
import {
  buildVisualFeedbackProbe,
  buildNativeBrowserProbe,
} from '../../../scripts/build-visual-feedback-probe.mjs'
import {
  STAGED_DESKTOP_NOTICE_FILES,
  stageThirdPartyNotices,
} from '../../../scripts/stage-third-party-notices.mjs'
import {
  EMBEDDED_MIGRATIONS_FLAG,
  embeddedMigrationsPlugin,
} from '../../../scripts/embed-migrations-plugin.mjs'
import { buildStagedCliPackageMetadata } from './cli-package-metadata.mjs'
import { assertRunsAs, fetchBaselineBun } from './sidecar-bun.mjs'
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
// expensive API/mini app bundle and UI type-check/build independent so a Rust-
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
  ...BUNDLED_DIRS.map((dir) => join(repo, dir)),
  join(desktop, 'scripts'),
  join(repo, 'scripts', 'build-visual-feedback-probe.mjs'),
  join(repo, 'scripts', 'stage-dropins.mjs'),
  join(repo, 'scripts', 'lib', 'bundled-roots.mjs'),
  join(repo, 'scripts', 'embed-migrations-plugin.mjs'),
  join(desktop, 'scripts', 'sidecar-bun.mjs'),
  join(repo, 'scripts', 'stage-mini-app-ui.mjs'),
  join(repo, 'scripts', 'build-mini-app-ui.mjs'),
  // Everything the mini app kit is made from — the same list the dev watcher re-stages on.
  ...MINI_APP_KIT_INPUTS.map((input) => join(repo, input)),
  join(repo, 'scripts', 'stage-third-party-notices.mjs'),
  join(repo, 'scripts', 'rust-third-party-notices.mjs'),
  join(desktop, 'licenses'),
  join(desktop, 'src-tauri', 'Cargo.lock'),
  join(repo, 'vendor', 'monaco-editor-runtime'),
  join(repo, 'bun.lock'),
  join(repo, 'LICENSE'),
  join(repo, 'tsconfig.base.json'),
  tauriConfigFile,
  fileURLToPath(import.meta.url),
])
// Which Bun the sidecar is (see sidecar-bun.mjs): switching it must restage, and it is not a file.
const runtimeVariant = process.env.LOCALIX_SIDECAR_BASELINE === '1' ? 'baseline' : 'build'
const runtimeReady =
  cache.runtime === runtimeKey &&
  cache.runtimeVariant === runtimeVariant &&
  existsSync(join(resources, 'server.js')) &&
  existsSync(join(resources, SCRIPT_WORKER_FILE)) &&
  existsSync(join(resources, MOD_RUNTIME_FILE)) &&
  existsSync(join(resources, SCRIPT_WASM_FILE)) &&
  Object.values(SCRIPT_EXTENSION_FILES).every((file) => existsSync(join(resources, file))) &&
  existsSync(join(resources, 'visual-feedback-probe.js')) &&
  existsSync(join(resources, 'visual-feedback-native-probe.js')) &&
  existsSync(join(resources, 'mini-app-kit', 'kit.json')) &&
  existsSync(join(resources, 'cli', 'server', 'cli.js')) &&
  existsSync(join(resources, 'cli', 'package.json')) &&
  existsSync(join(resources, 'LICENSE')) &&
  STAGED_DESKTOP_NOTICE_FILES.every((filename) =>
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
    desktop: { targetTriple: hostTriple() },
  })

  // ── 1. bundle the API to resources/server.js (mini apps stay on disk). Use --outdir (not
  // --outfile) so bun can also emit the native
  //       required `.node` addons it references beside server.js — --outfile refuses
  //       multiple outputs.
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
  const watcherExternals = PARCEL_WATCHER_ADDONS.filter((addon) => addon !== hostAddon)
  log('bundling API →', serverOut)
  // The migrations are compiled into server.js by the Bun plugin: nothing is staged beside it, and
  // `kysely` is bundled with the migrations instead of copied next to loose files.
  const bundled = await Bun.build({
    entrypoints: [apiEntry],
    target: 'bun',
    outdir: resources,
    naming: { entry: 'server.js' },
    minify: { syntax: true, whitespace: true, identifiers: false },
    external: watcherExternals,
    define: { [EMBEDDED_MIGRATIONS_FLAG]: 'true' },
    plugins: [embeddedMigrationsPlugin(join(repo, 'apps', 'api', 'migrations'))],
  })
  if (!bundled.success) {
    for (const message of bundled.logs) console.error(message)
    throw new Error('bundling the API failed')
  }
  // ── 1b. the script sandbox (`codemode`, and the VM each mod runs in): its VM starts in a worker
  //        thread from a file beside the module that creates it, and reads the QuickJS binary and
  //        its extensions from disk. server.js has none of them beside it, so they are staged here,
  //        where `bundledScriptSandboxOptions` finds them.
  //        The worker is the package's `./worker` export, resolved from the engine that imports
  //        the package — the same build server.js bundled the host side from, so the two always
  //        speak the same protocol. ──
  const scriptWorker = await Bun.build({
    entrypoints: [
      Bun.resolveSync('@localixai/engine-scripts/worker', join(repo, 'packages', 'engine')),
    ],
    target: 'bun',
    outdir: resources,
    naming: { entry: SCRIPT_WORKER_FILE },
    minify: { syntax: true, whitespace: true, identifiers: false },
  })
  if (!scriptWorker.success) {
    for (const message of scriptWorker.logs) console.error(message)
    throw new Error('bundling the script sandbox worker failed')
  }
  const quickjs = createRequire(join(repo, 'packages', 'engine-scripts', 'package.json'))
  copyFileSync(quickjs.resolve('quickjs-wasi/quickjs.wasm'), join(resources, SCRIPT_WASM_FILE))
  for (const [name, file] of Object.entries(SCRIPT_EXTENSION_FILES))
    copyFileSync(quickjs.resolve(`quickjs-wasi/${name}.so`), join(resources, file))
  // ── 1c. the runtime each mod's VM runs before its hooks module: one script for QuickJS, which
  //        the mods bootstrap reads beside server.js (`loadModRuntime`). ──
  writeFileSync(join(resources, MOD_RUNTIME_FILE), await buildModRuntime())
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

  // ── 3. the mini app kit ────────────────────────────────────────────────────────
  // The app ships no mini app (rule X5): the store installs them from the hosted catalog the
  // release publishes (`scripts/pack-mini-apps.mjs`). It ships the kit, which the installed app
  // needs to create and build the person's own mini apps without a source tree.
  stageMiniAppKitBeside({ repoRoot: repo, outMiniApps: join(resources, STAGED_APPS_DIR) })

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
  // The release workflow asks for the baseline build (see sidecar-bun.mjs): the Bun that ran this
  // build is chosen by the CI runner's CPU, and the sidecar must run on the user's.
  let sidecarSource
  if (process.env.LOCALIX_SIDECAR_BASELINE === '1') {
    sidecarSource = await fetchBaselineBun({
      version: Bun.version,
      dest: join(desktop, 'src-tauri', 'target', 'sidecar-bun'),
    })
    if (sidecarSource) {
      assertRunsAs(sidecarSource, Bun.version)
      log('sidecar is the baseline Bun', Bun.version)
    } else {
      log('no baseline Bun for this platform; the sidecar is the build Bun')
    }
  }
  const { path: bunDst } = stageSidecarBun({ force: true, source: sidecarSource })
  log('staged sidecar', basename(bunDst))
  cache.runtime = runtimeKey
  cache.runtimeVariant = runtimeVariant
} else {
  log('runtime inputs unchanged — reusing staged API, mini apps, CLI and Bun')
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
      ...BUNDLED_DIRS.map((dir) => join(repo, dir)),
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
  // A mini app installed as its own Mac app is a separate process: it cannot read the UI Tauri
  // embeds in the shell binary, so it serves this copy from the bundle (`app_runner_scheme.rs`).
  if (process.platform === 'darwin') {
    const staged = join(resources, 'ui')
    rmSync(staged, { recursive: true, force: true })
    cpSync(join(repo, 'apps', 'ui', 'dist'), staged, { recursive: true })
    log('UI staged for standalone mini apps')
  }
  log('UI ready')
}

mkdirSync(dirname(cacheFile), { recursive: true })
writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`)

log('done.')
