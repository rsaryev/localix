// Shared drop-in staging — the ONE implementation every packager calls:
//   apps/desktop-tauri/scripts/prepare-sidecar.mjs → resources/mini apps
//
// Stages repo-root `mini apps/` as a sibling of the server bundle so
// the server self-locates them (no LOCALIX_BUNDLED_*_DIR env). Tool entrypoints
// may be JS/MJS/TS and can import `@localixai/*` or npm packages
// that only resolve in the repo tree. Every such entrypoint is PRE-BUNDLED from the
// repo tree and the staged manifest is repointed at the self-contained bundle.
//
// Shipped mini apps are pre-bundled and self-contained, so DEV-ONLY files never ride
// along: per-mini-app `package.json`/`tsconfig.json` (workspace/dep declarations),
// `node_modules`, tests, and tmp dirs are stripped in the copy. Authoring-only mini app
// directories declare `private: true` in their own manifest and are never shipped.
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  backendField,
  hasExtensionManifest,
  isClaudeCodePluginOnly,
  localixManifestFile,
  readExtensionManifest,
} from './lib/extension-manifest.mjs'
import { bundledFolderOf, bundledRoots } from './lib/bundled-roots.mjs'
import {
  discardStagedUiArtifact,
  miniAppKitDirOf,
  stageMiniAppUi,
  takeStagedUiArtifact,
} from './stage-mini-app-ui.mjs'
import { MINI_APP_BACKEND_HOST_MODULES } from '@localixai/api/mini-app-kit-layout'

const KIT_STAGER = fileURLToPath(new URL('./stage-mini-app-kit.mjs', import.meta.url))

/**
 * Stage the mini app kit beside `outMiniApps` (a child `bun`: it uses the async bundler). Every
 * packager calls it BEFORE {@link stageDropins}: the mini app UI builds read the kit, and the app
 * needs it to create and build user mini apps. A failure is always fatal — an app without its kit
 * builds no mini app UI at all.
 */
/** `--cache=<dir>` when the caller keeps a kit cache (development); packaging stages fresh. */
const cacheArgs = (cacheRoot) => (cacheRoot ? [`--cache=${cacheRoot}`] : [])

export function stageMiniAppKitBeside({ repoRoot, outMiniApps, cacheRoot, run = execFileSync }) {
  run('bun', [KIT_STAGER, repoRoot, miniAppKitDirOf(outMiniApps), ...cacheArgs(cacheRoot)], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

/**
 * {@link stageMiniAppKitBeside} without blocking the caller: the dev supervisor re-stages the kit
 * while it also supervises the API, and a synchronous child stalled it for the ~3s a stage takes.
 * Resolves when the stage succeeds, rejects with its exit status otherwise.
 */
export function stageMiniAppKitBesideAsync({ repoRoot, outMiniApps, cacheRoot, run = spawn }) {
  return new Promise((resolveStage, rejectStage) => {
    const args = [KIT_STAGER, repoRoot, miniAppKitDirOf(outMiniApps), ...cacheArgs(cacheRoot)]
    const child = run('bun', args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.once('error', rejectStage)
    child.once('exit', (code, signal) =>
      code === 0
        ? resolveStage()
        : rejectStage(new Error(`the mini app kit stager exited with ${signal ?? code}`)),
    )
  })
}

/** Marks a complete, packager-produced mini apps root (written only after bundling succeeds). */
export const STAGED_DROPINS_MARKER = '.localix-staged.json'
// ssh2 treats cpu-features as a best-effort acceleration (its require is guarded
// by try/catch). Keeping it external prevents Bun from requiring a locally compiled
// cpufeatures.node during packaging; the staged mini app intentionally falls back to
// ssh2's portable implementation when the optional package is absent.
const OPTIONAL_NATIVE_EXTERNALS = ['cpu-features']
// Unminified backends were ~40% of the shipped mini apps (53.8 MB of JS, every one carrying its own
// zod and hono) and are read and parsed on every app start. Whitespace and syntax minification
// roughly halves them; identifiers are KEPT so a mini app's stack trace still names its functions —
// the only diagnostic a user's report carries. Dev and release stage with the same flags, so a
// defect minification introduces shows up in development first.
const BACKEND_MINIFY_FLAGS = ['--minify-syntax', '--minify-whitespace']
/** Dev-only entries stripped from every staged drop-in. */
const SKIP_BASENAMES = new Set([
  '.localix-plugin',
  '.turbo',
  'node_modules',
  'package.json',
  'tsconfig.json',
  'tmp',
  'bun.lock',
])
const TEST_FILE_RE = /\.test\.[a-z]+$/
const UI_AUTHORING_SOURCE_RE = /\.(?:[cm]?ts|tsx)$/i
const BUNDLEABLE_TOOLS_ENTRY_RE = /\.(?:js|mjs|ts)$/i
const MANAGED_MINI_APP_MARKER = '.localix-managed.json'

const BUILD_OUTPUT_DIR = 'dist'
const UNDER_BUILD_OUTPUT_RE = /^(?:\.\/)?dist(?:\/|$)/u

/**
 * Whether a mini app's manifest names a runtime file under `dist/` (a prebuilt `tools`, say).
 *
 * A mini app's `dist/` is otherwise build output, gitignored, and never what the app runs: staging
 * builds the UI artifact into `dist/ui` itself, after the copy. Copied, it made the shipped tree
 * depend on the build machine — a local `mini-apps/template/dist` (vite preview assets, a tsc emit)
 * rode into a release built on a laptop and not into one built by CI.
 */
function manifestDeclaresBuildOutput(miniAppDir) {
  let manifest
  try {
    manifest = readExtensionManifest(miniAppDir)
  } catch {
    return false
  }
  const visit = (value) =>
    typeof value === 'string'
      ? UNDER_BUILD_OUTPUT_RE.test(value)
      : value && typeof value === 'object' && Object.values(value).some(visit)
  return visit(manifest)
}

/** cpSync filter: false to skip a source path. `root` is the tree being copied. */
function makeCopyFilter(root, { skipTopDirs = new Set() } = {}) {
  const declaresBuildOutput = new Map()
  return (src) => {
    const rel = relative(root, src)
    if (!rel) return true
    const [top] = rel.split(sep)
    if (skipTopDirs.has(top)) return false
    const base = basename(src)
    if (SKIP_BASENAMES.has(base)) return false
    if (TEST_FILE_RE.test(base)) return false
    const segments = rel.split(sep)
    if (segments.length === 2 && base === BUILD_OUTPUT_DIR) {
      if (!declaresBuildOutput.has(top))
        declaresBuildOutput.set(top, manifestDeclaresBuildOutput(join(root, top)))
      if (!declaresBuildOutput.get(top)) return false
    }
    if (segments.slice(1, -1).includes('ui') && UI_AUTHORING_SOURCE_RE.test(base)) return false
    return true
  }
}

/** Manifest-owned distribution policy; no packager list of concrete mini app names. */
function privateMiniAppDirs(root) {
  const result = new Set()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = readExtensionManifest(join(root, entry.name))
      if (manifest.private === true) result.add(entry.name)
    } catch {
      // Validation reports malformed manifests later; staging must not hide them by name.
    }
  }
  return result
}

/** Directories containing manifest-owned runtime scripts and their local helpers. */
function manifestRuntimeSourceDirs(manifest, repoMiniApp) {
  const directories = new Set()
  const visit = (value, key = '') => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
      return
    }
    if (
      key === 'tools' ||
      key === 'backend' ||
      typeof value !== 'string' ||
      !value.startsWith('.') ||
      !UI_AUTHORING_SOURCE_RE.test(value)
    ) {
      return
    }
    const source = resolve(repoMiniApp, value)
    const miniAppRelative = relative(repoMiniApp, source)
    if (
      miniAppRelative &&
      miniAppRelative !== '..' &&
      !miniAppRelative.startsWith(`..${sep}`) &&
      !isAbsolute(miniAppRelative)
    ) {
      directories.add(dirname(source))
    }
  }
  visit(manifest)
  return directories
}

/** Remove authored TS that Bun proved it absorbed into the emitted backend bundle. */
function pruneBundledAuthoringSources(
  repoRoot,
  repoMiniApp,
  stagedMiniApp,
  metafile,
  protectedSourceDirs,
) {
  let removed = 0
  for (const input of Object.keys(metafile.inputs ?? {})) {
    const source = resolve(repoRoot, input)
    const miniAppRelative = relative(repoMiniApp, source)
    if (
      !miniAppRelative ||
      miniAppRelative === '..' ||
      miniAppRelative.startsWith(`..${sep}`) ||
      isAbsolute(miniAppRelative) ||
      !UI_AUTHORING_SOURCE_RE.test(miniAppRelative) ||
      [...protectedSourceDirs].some(
        (directory) => source === directory || source.startsWith(`${directory}${sep}`),
      )
    ) {
      continue
    }
    const stagedSource = join(stagedMiniApp, miniAppRelative)
    if (!existsSync(stagedSource)) continue
    rmSync(stagedSource, { force: true })
    removed += 1
  }
  return removed
}

/**
 * Fingerprint the FINAL staged tree with the same path/mode/content framing used
 * by runtime bundled-mini-app synchronization. The packager pays this once while
 * every file is already hot; a packaged runtime can then compare its managed-copy
 * marker with this trusted staging marker instead of reading every mini app byte.
 */
function fingerprintMiniAppTree(root) {
  const hash = createHash('sha256')
  const visit = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
      if (entry.name === MANAGED_MINI_APP_MARKER) continue
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      const stat = lstatSync(path)
      hash.update(`${rel}\0${stat.mode}\0`)
      if (entry.isDirectory()) {
        hash.update('directory\0')
        visit(path)
      } else if (entry.isSymbolicLink()) {
        hash.update('symlink\0').update(readlinkSync(path)).update('\0')
      } else if (entry.isFile()) {
        hash.update('file\0').update(readFileSync(path)).update('\0')
      } else {
        hash.update(`other\0${stat.size}\0${stat.mtimeMs}\0`)
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}

/**
 * @typedef StageDropinsOptions
 * @property {string} repoRoot
 * @property {string} outMiniApps
 * @property {(message: string) => void} [log]
 * @property {typeof execFileSync} [runUiBuild] Runs the UI artifact builder (a child `bun`).
 * @property {'fatal' | 'skip'} [onMiniAppError] How a mini app that fails to bundle is handled.
 *   `fatal` (the default, and what a RELEASE build must use) aborts staging: shipping an app with
 *   a silently missing mini app is worse than not shipping. `skip` drops that one mini app and
 *   stages the rest — the right answer in DEVELOPMENT, where one mini app mid-edit used to take the
 *   whole API down and, with it, `bun run dev`.
 * @property {boolean} [uiSourceMaps] Emit mini app UI source maps (default true). A RELEASE passes
 *   false: nobody debugs a first-party mini app's UI on a user's machine, and its maps were 17 MB
 *   of the installer. Development keeps them for the browser's devtools.
 */

/**
 * Stage `mini apps/` from `repoRoot` into `outMiniApps` (replacing the previous
 * output), then pre-bundle every staged mini app whose manifest `tools` is a
 * JavaScript or TypeScript entry.
 * @param {StageDropinsOptions} options
 * @returns {{ skipped: { name: string, reason: string }[] }}
 */
export function stageDropins({
  repoRoot,
  outMiniApps,
  log = () => {},
  onMiniAppError = 'fatal',
  runUiBuild = execFileSync,
  uiSourceMaps = true,
}) {
  /** @type {{ name: string, reason: string }[]} */
  const skipped = []

  // Both bundled folders, mini apps and mini apps, stage into the one root the API reads.
  if (existsSync(outMiniApps)) rmSync(outMiniApps, { recursive: true })
  /** @type {string[]} */
  const names = []
  for (const repoMiniApps of bundledRoots(repoRoot)) {
    if (!existsSync(repoMiniApps)) continue
    // A folder without a manifest is not an extension: a checkout keeps ignored build caches
    // (`.turbo`, `node_modules`) in the folders a move left behind, and copying one over the
    // extension of the same name in the other root broke its staging. A name staged from an
    // earlier root keeps that copy.
    const skipTopDirs = privateMiniAppDirs(repoMiniApps)
    for (const entry of readdirSync(repoMiniApps, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const folder = join(repoMiniApps, entry.name)
      // A Claude Code plugin is a built-in plugin, staged on its own (`stage-builtin-plugins.mjs`).
      if (
        names.includes(entry.name) ||
        !hasExtensionManifest(folder) ||
        isClaudeCodePluginOnly(folder)
      )
        skipTopDirs.add(entry.name)
      else if (!skipTopDirs.has(entry.name)) names.push(entry.name)
    }
    cpSync(repoMiniApps, outMiniApps, {
      recursive: true,
      force: true,
      filter: makeCopyFilter(repoMiniApps, { skipTopDirs }),
    })
  }

  // Pre-bundle tools FROM THE REPO TREE, where workspace deps (declared in a
  // mini app's own package.json) and `@localixai/*` imports resolve. This includes
  // authored .mjs tools: copying those as-is made an installed ~/.localix copy
  // accidentally depend on the monorepo's node_modules.
  //
  // --outdir (not --outfile) lets native .node addons referenced by a backend
  // (e.g. ssh2's DB SSH tunnel) be emitted beside the bundle.
  const staging = { repoRoot, outMiniApps, log, onMiniAppError }
  for (const name of names) {
    const failure = bundleStagedMiniAppBackend(name, staging)
    if (failure) skipped.push(failure)
    // After the backend: a mini app removed for a backend failure has no copy to put a UI into.
    else stageMiniAppUi(name, { ...staging, run: runUiBuild, uiSourceMaps })
  }
  writeStagingMarker(
    outMiniApps,
    Object.fromEntries(skipped.map((entry) => [entry.name, entry.reason])),
  )
  log('staged mini apps')
  if (skipped.length > 0) {
    log(
      `${skipped.length} mini app(s) unavailable this run: ${skipped.map((entry) => entry.name).join(', ')} — fix the error printed above to restore them`,
    )
  }
  return { skipped }
}

/**
 * Pre-bundle ONE already-copied mini app's backend in place, repointing its staged manifest at
 * the self-contained bundle. Returns the skip record when the bundle fails and the caller
 * asked for `skip`; throws under `fatal`. A mini app without a bundleable `tools` entry is
 * left as copied.
 */
function bundleStagedMiniAppBackend(name, { repoRoot, outMiniApps, log, onMiniAppError }) {
  // The backend entry lives in the Localix layer: a mini app's `backend`, or a legacy `tools`.
  const manifestPath = localixManifestFile(join(outMiniApps, name))
  if (!manifestPath) return null
  const field = backendField(manifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest[field] !== 'string' || !BUNDLEABLE_TOOLS_ENTRY_RE.test(manifest[field]))
    return null
  const repoMiniApp = bundledFolderOf(repoRoot, name) ?? join(outMiniApps, name)
  const repoEntry = join(repoMiniApp, manifest[field])
  const stagedMiniApp = join(outMiniApps, name)
  const outDir = join(outMiniApps, name, 'backend')
  const protectedSourceDirs = manifestRuntimeSourceDirs(
    readExtensionManifest(repoMiniApp),
    repoMiniApp,
  )
  mkdirSync(outDir, { recursive: true })
  const metadataDir = mkdtempSync(join(outDir, '.localix-bundle-'))
  const metadataPath = join(metadataDir, 'metafile.json')
  log(`pre-bundling ${name} backend…`)
  try {
    runBunBuild(repoRoot, [
      repoEntry,
      '--target=bun',
      '--outdir',
      outDir,
      '--entry-naming',
      'index.bundle.mjs',
      '--splitting',
      '--chunk-naming',
      'chunks/[name]-[hash].[ext]',
      `--metafile=${metadataPath}`,
      ...BACKEND_MINIFY_FLAGS,
      ...OPTIONAL_NATIVE_EXTERNALS.flatMap((dependency) => ['--external', dependency]),
      // The host serves these at runtime (`backend-host-modules.ts`); bundling them put a copy
      // of zod, hono and the SDK into every backend.
      ...MINI_APP_BACKEND_HOST_MODULES.flatMap((specifier) => ['--external', specifier]),
    ])
    const metafile = JSON.parse(readFileSync(metadataPath, 'utf8'))
    assertHostModulesImportedByMiniAppCode(name, metafile)
    const removed = pruneBundledAuthoringSources(
      repoRoot,
      repoMiniApp,
      stagedMiniApp,
      metafile,
      protectedSourceDirs,
    )
    if (removed > 0) log(`removed ${removed} bundled ${name} source files`)
  } catch (error) {
    // One mini app's compile error is not the whole workspace's problem — unless we are building
    // something to ship. `bun build` has already printed the real diagnostic (file, line, the
    // unresolved import) above; this line names the consequence so it is obvious in dev why a
    // capability is missing, instead of the API simply failing to boot. The reason travels in the
    // staging marker to the running app, which raises it as a standing mini app condition.
    if (onMiniAppError === 'fatal') throw error
    const reason = error instanceof Error ? error.message : String(error)
    log(`SKIPPED ${name}: its backend failed to bundle — ${reason}`)
    rmSync(join(outMiniApps, name), { recursive: true, force: true })
    return { name, reason }
  } finally {
    rmSync(metadataDir, { recursive: true, force: true })
  }
  manifest[field] = './backend/index.bundle.mjs'
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return null
}

/**
 * Re-stage ONE mini app into an existing staged root: the dev workspace's answer to a mini app
 * that was scaffolded or edited after boot. Whole-tree staging deletes and rebuilds every
 * mini app (seconds per backend, and the API's sync sees a root with no marker while it runs);
 * this replaces one directory and rewrites the marker, so every other mini app stays served.
 * A mini app that turned `private`, or vanished, is removed from the staged root.
 */
export function restageMiniApp({
  repoRoot,
  outMiniApps,
  name,
  log = () => {},
  onMiniAppError = 'skip',
  runUiBuild = execFileSync,
}) {
  const repoMiniApp = bundledFolderOf(repoRoot, name)
  const repoMiniApps = repoMiniApp ? dirname(repoMiniApp) : bundledRoots(repoRoot)[0]
  const stagedMiniApp = join(outMiniApps, name)
  // Set the running UI aside first: a UI build that fails mid-edit puts it back.
  const previousUi = existsSync(stagedMiniApp) ? takeStagedUiArtifact(stagedMiniApp) : null
  rmSync(stagedMiniApp, { recursive: true, force: true })
  const present =
    repoMiniApp !== null &&
    hasExtensionManifest(repoMiniApp) &&
    !privateMiniAppDirs(repoMiniApps).has(name)
  let failure = null
  if (present) {
    // The filter reasons about paths RELATIVE TO THE MINI_APPS ROOT (`<name>/ui/…`), same as
    // the whole-tree copy, so the ui-authoring-source rule sees the same segments.
    cpSync(repoMiniApp, stagedMiniApp, { recursive: true, filter: makeCopyFilter(repoMiniApps) })
    failure = bundleStagedMiniAppBackend(name, {
      repoRoot,
      outMiniApps,
      log,
      onMiniAppError,
    })
    if (!failure) {
      stageMiniAppUi(name, {
        repoRoot,
        outMiniApps,
        log,
        onMiniAppError,
        previous: previousUi,
        run: runUiBuild,
      })
    }
  }
  // Removed, or dropped for a backend failure: nothing will take the set-aside UI back.
  if (!present || failure) discardStagedUiArtifact(previousUi)
  const unavailable = readStagingUnavailable(outMiniApps)
  delete unavailable[name]
  if (failure) unavailable[name] = failure.reason
  writeStagingMarker(outMiniApps, unavailable)
  log(present ? `re-staged ${name}` : `removed ${name} from the staged mini apps`)
  return { staged: present && !failure, ...(failure ? { skipped: failure } : {}) }
}

/**
 * Refuse a backend in which a THIRD-PARTY package imports a host-provided module.
 *
 * Leaving `zod` external makes every `import 'zod'` in the bundle's graph the host's copy — a
 * dependency written against another major (zod 3, say) would receive zod 4 at runtime and break
 * in ways no build step reports. Only the mini app's own code and the workspace packages are
 * versioned with the host; a node_modules importer means the mini app needs that dependency's own
 * copy, which is a decision to make (bundle it under another name), not a silent swap.
 */
export function assertHostModulesImportedByMiniAppCode(name, metafile) {
  const hostModules = new Set(MINI_APP_BACKEND_HOST_MODULES)
  const offenders = []
  for (const [input, meta] of Object.entries(metafile.inputs ?? {})) {
    if (!input.includes('node_modules/') || input.includes('node_modules/@localixai/')) continue
    for (const imported of meta.imports ?? []) {
      if (imported.external && hostModules.has(imported.path))
        offenders.push(`${imported.path} <- ${input.replace(/^.*node_modules\//u, '')}`)
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `${name}: a dependency imports a host-provided module and would get the host's version: ${offenders.join('; ')}`,
    )
  }
}

/**
 * Run `bun build`, keeping its diagnostic for the caller.
 *
 * The defect this prevents: with the output inherited, the only reason a skipped mini app carried
 * was "Command failed: bun build …" — the unresolved import that actually broke it reached the
 * console and nowhere else, so the running app could only say "unavailable". The diagnostic is
 * still echoed as it was; the thrown error now carries its `error:` lines and their locations.
 */
function runBunBuild(repoRoot, args) {
  const result = spawnSync('bun', ['build', ...args], {
    cwd: repoRoot,
    stdio: ['ignore', 'inherit', 'pipe'],
    encoding: 'utf8',
  })
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status === 0) return
  throw new Error(bunBuildFailureReason(result.stderr ?? '', repoRoot) || 'bun build failed')
}

/**
 * The lines of a `bun build` failure a person acts on: each `error:` and the `at <file>:<line>`
 * that follows it, with the path relative to the repository. The source excerpt and caret bun
 * prints above each error are layout for a terminal, not a reason.
 */
export function bunBuildFailureReason(stderr, repoRoot) {
  const lines = stderr.split(/\r?\n/u).map((line) => line.trim())
  const reasons = []
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('error:')) continue
    const at = lines[index + 1]?.startsWith('at ') ? lines[index + 1].slice(3) : ''
    const where = at && isAbsolute(at) ? relative(repoRoot, at) : at
    reasons.push(where ? `${line} (${where})` : line)
  }
  return reasons.join('\n')
}

/** The failure reasons the current marker records, by mini app name. */
export function readStagingUnavailable(outMiniApps) {
  try {
    const marker = JSON.parse(readFileSync(join(outMiniApps, STAGED_DROPINS_MARKER), 'utf8'))
    const unavailable = marker?.unavailable
    return unavailable && typeof unavailable === 'object' && !Array.isArray(unavailable)
      ? { ...unavailable }
      : {}
  } catch {
    return {}
  }
}

/**
 * Write the root marker: one content hash per staged mini app, in name order, and the reason each
 * mini app that failed to stage is missing.
 *
 * `unavailable` exists because a missing directory alone is ambiguous: the sync retired the
 * managed copy of any mini app absent from the staged root, so one compile error mid-edit also took
 * down the copy that last worked, and the app learned nothing about why. A named failure keeps
 * that copy and reaches the user as a condition instead.
 *
 * Written to a temporary file and renamed over the marker, so a reader never sees half of one.
 */
function writeStagingMarker(outMiniApps, unavailable = {}) {
  const miniAppHashes = Object.fromEntries(
    readdirSync(outMiniApps, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasExtensionManifest(join(outMiniApps, entry.name)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => [entry.name, fingerprintMiniAppTree(join(outMiniApps, entry.name))]),
  )
  const markerPath = join(outMiniApps, STAGED_DROPINS_MARKER)
  const pendingPath = `${markerPath}.${process.pid}.tmp`
  writeFileSync(
    pendingPath,
    JSON.stringify(
      {
        kind: 'localix-staged-mini-apps',
        schemaVersion: 3,
        hashAlgorithm: 'sha256',
        miniAppHashes,
        unavailable: Object.fromEntries(
          Object.entries(unavailable).sort(([a], [b]) => a.localeCompare(b)),
        ),
      },
      null,
      2,
    ) + '\n',
  )
  renameSync(pendingPath, markerPath)
}
