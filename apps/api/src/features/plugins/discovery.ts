import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { listSubdirs, mergeByPrecedence, pathExists as _pathExists } from '../ext/fs-discovery'
import { normalizeCcToolName } from '../ext/cc-tool-names'
import { isExtensionPublicationArtifact } from '../ext/publish-tree'
import { resolveBundledRoot } from '../../lib/bundled-root'
import { envString } from '../../lib/env'
import { locateManifest, PLUGIN_MANIFEST_CANDIDATES } from './manifest-locate'

import type { PluginAgent, PluginCommand, PluginManifest, PluginProvides } from './contracts'
import type { ResolvedEntrypoints } from './discovery-entrypoints'
import { loadManifest } from './manifest-load'
import { syncBundledPlugins } from './bundled-install'

// Re-export so importers (loader.ts, discovery.test.ts) keep their existing
// `./discovery` surface for entrypoint resolution.
export { resolveEntrypoints, type ResolvedEntrypoints } from './discovery-entrypoints'

/**
 * Filesystem plugin discovery. A plugin is a directory with a `plugin.json`
 * manifest under one of:
 *
 *   ~/.localix/plugins/<name>/      (sessions without a project)
 *   <project>/.localix/plugins/<name>/   (project-scoped)
 *
 * Project and no-project installs are isolated. Managed first-party plugins are
 * the exception: their artifacts are synchronized into the home root once, then
 * projected into every requested scope with that scope's `projectId`, so their
 * enable/config state remains exact-scope even though their code is shared.
 */

const PLUGIN_SUBDIRS = ['.localix/plugins']
const BUNDLED_STAGING_MARKER = '.localix-staged.json'
const SCAN_CACHE_VERSION = 1
const SCAN_CACHE_FILE = 'plugin-scan-cache-v1.json'
const SCAN_CACHE_REVALIDATE_MS = 3_000

interface ScanFingerprintEntry {
  path: string
  mtimeMs: number
  size: number
  directory: boolean
}

interface PluginScanCache {
  version: number
  scanKey: string
  fingerprint: ScanFingerprintEntry[]
  plugins: DiscoveredPlugin[]
}

const scanCacheRevalidations = new Map<string, Promise<void>>()
// A boot's backend host, cache warm and first snapshots may request the same scope
// together. Share only in-flight scans; a later call must still check the filesystem.
const scansInFlight = new Map<string, Promise<DiscoveredPlugin[]>>()

/**
 * Repo/packaged first-party plugin SOURCE root. Normal runtime discovery never
 * executes it directly: artifacts are synchronized into `~/.localix/plugins`
 * first. It also doubles as the authoring/marketplace source. SELF-LOCATED from this
 * module's own URL (see `lib/bundled-root.ts` for the rule): the
 * LOCALIX_BUNDLED_PLUGINS_DIR override, else a staged `plugins/` sibling of this
 * module (the BUNDLED layout), else the repo root `plugins/` five levels up
 * (plugins → features → src → api → apps → root) when running from source.
 */
export function bundledPluginsRoot(): string {
  return resolveBundledRoot({
    moduleUrl: import.meta.url,
    dirName: 'plugins',
    sourceRelative: '../../../../../plugins',
    override: envString('LOCALIX_BUNDLED_PLUGINS_DIR'),
  })
}

/**
 * Runtime synchronization accepts either an explicitly supplied root (tests and
 * launchers own that trust decision) or a self-located packaged root carrying the
 * staging marker. The source-tree fallback intentionally fails this check: raw
 * repo plugins contain authoring files and unresolved TS/workspace imports and
 * must never be copied into the user's global install root.
 *
 * `discoverBundledPlugins()` deliberately does not use this gate — marketplace
 * generation and validation still inspect the raw authoring tree in-place.
 */
export async function bundledPluginsSyncRoot(): Promise<string | null> {
  const explicit = envString('LOCALIX_BUNDLED_PLUGINS_DIR')
  const root = bundledPluginsRoot()
  if (explicit || (await pathExists(join(root, BUNDLED_STAGING_MARKER)))) return root
  return null
}

export interface DiscoveredPlugin {
  manifest: PluginManifest
  /**
   * The raw parsed manifest object (pre-zod), kept so the validator can inspect
   * Claude Code spec fields our schema strips (lspServers, monitors, hooks-as-path…)
   * and flag cross-spec compatibility issues. Undefined on read/parse failure.
   */
  rawManifest?: Record<string, unknown>
  /** Absolute plugin directory. */
  dir: string
  scope: 'global' | 'project'
  /** '' for global; the active project id for project-scoped plugins. */
  projectId: string
  entrypoints: ResolvedEntrypoints
  /** Static capabilities (everything except native tool names, which need a load). */
  provides: PluginProvides
  /** Resolved slash-commands: inline manifest objects + Claude Code flat `.md` files. */
  commands: PluginCommand[]
  /** Resolved worker roles: inline manifest objects + Claude Code `agents/*.md` files. */
  agents: PluginAgent[]
  /** True for a managed first-party copy synchronized into the global Localix root. */
  bundled: boolean
  /** Manifest parse/validation error — the plugin still surfaces in the UI. */
  error?: string
  /**
   * True when the manifest had parse issues that were gracefully recovered (e.g.
   * unsupported config-option types were stripped). The plugin is NOT skipped by
   * the loader — `error` contains the non-fatal warning for the UI/validation report.
   */
  manifestRecovered?: boolean
  /**
   * Compatibility flag for an explicitly installed Claude-format plugin. Derived
   * from its `.claude-plugin/plugin.json` layout inside a Localix discovery root.
   */
  ccOrigin?: boolean
}

/** Return true if the path exists and is accessible, false otherwise. */
export const pathExists = _pathExists

/**
 * Locate a plugin's manifest. We support BOTH our native layout (`plugin.json` at
 * the plugin root) and the Claude Code convention (`.claude-plugin/plugin.json`),
 * so a plugin explicitly installed into a Localix discovery root can retain that
 * layout. The root manifest wins when both exist. Returns null when neither is present.
 */
export async function findManifestPath(dir: string): Promise<string | null> {
  return locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)
}

/** Default component locations that make a manifest-less directory a valid plugin. */
const PLUGIN_COMPONENT_PATHS = ['skills', 'commands', 'agents', '.mcp.json', 'tools']

/**
 * Is `dir` a plugin? True when it has a manifest (root or `.claude-plugin/`) OR — the
 * Claude Code convention where the manifest is optional — at least one recognized
 * component directory/file (skills/commands/agents/tools/.mcp.json). Bare dirs (e.g. a
 * `cache`) are skipped. LSP-only plugins (just `.lsp.json`) are intentionally NOT
 * plugins here, since this host doesn't load plugin LSP servers.
 */
async function isPluginDir(dir: string): Promise<boolean> {
  if (await findManifestPath(dir)) return true
  // Check all component paths in parallel — any one present makes this a plugin.
  const checks = await Promise.all(PLUGIN_COMPONENT_PATHS.map((c) => pathExists(join(dir, c))))
  return checks.some(Boolean)
}

// Re-export so importers (loader-contract.ts, run/permission-gate-build.ts) that depend on this
// module's path continue to work without import-path changes.
export { normalizeCcToolName }

// Manifest parsing (loadManifest) lives in manifest-load.ts. Re-exported here so
// the historical `./discovery` import surface stays stable for service.ts, the
// loader, and the discovery/validate tests. (parseInlineCommands/readSkillNames
// are loadManifest internals — not re-exported, no external consumer.)
export { loadManifest } from './manifest-load'

/**
 * Generic plugin directory scanner. Iterates `subdirs` under `baseDir` (pass `''` to
 * scan `baseDir` itself), calls `isPluginDir` (manifest or component dirs), and loads
 * each.
 */
/**
 * Atomic bundled-plugin installs briefly place complete plugin trees beside the
 * canonical install directory. They are transaction artifacts, never discovery
 * roots: loading one races its rename/removal and can replace a healthy plugin
 * with an entry whose native backend disappears before it is imported.
 */
function isPluginSyncArtifact(name: string): boolean {
  return name.startsWith('.sync-') || isExtensionPublicationArtifact(name)
}

async function scanDirs(
  baseDir: string,
  subdirs: string[],
  scope: 'project' | 'global',
  projectId: string,
  opts?: {
    bundled?: boolean
    bundledNames?: ReadonlySet<string>
  },
): Promise<DiscoveredPlugin[]> {
  // All subdirs are independent — scan them in parallel.
  const batches = await Promise.all(
    subdirs.map(async (sub) => {
      const root = sub ? join(baseDir, sub) : baseDir
      const names = (await listSubdirs(root)).filter((name) => !isPluginSyncArtifact(name))
      const candidates = await Promise.all(
        names.map(async (name) => {
          const dir = join(root, name)
          const valid = await isPluginDir(dir)
          return valid
            ? loadManifest(dir, scope, projectId, opts?.bundled ?? opts?.bundledNames?.has(name))
            : null
        }),
      )
      return candidates.filter(
        (plugin): plugin is DiscoveredPlugin =>
          plugin !== null && !(opts?.bundled && plugin.manifest.private === true),
      )
    }),
  )
  return batches.flat()
}

async function fingerprintPath(path: string): Promise<ScanFingerprintEntry | null> {
  try {
    const stat = await fs.stat(path)
    return {
      path,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      directory: stat.isDirectory(),
    }
  } catch {
    return null
  }
}

/**
 * Record every directory entry once after a real scan. Later boots only `stat`
 * these known paths in parallel: a file edit changes its own mtime/size, while an
 * add/remove/rename changes the containing directory's mtime. This is the same
 * evidence boundary as a directory fingerprint, widened to every
 * discovery-bearing file so an unchanged fingerprint cannot hide a command,
 * agent, hook, or manifest edit.
 */
async function buildScanFingerprint(roots: string[]): Promise<ScanFingerprintEntry[]> {
  const found: ScanFingerprintEntry[] = []

  async function visit(path: string): Promise<void> {
    const entry = await fingerprintPath(path)
    if (!entry) {
      found.push({ path, mtimeMs: -1, size: -1, directory: false })
      return
    }
    found.push(entry)
    if (!entry.directory) return
    let names: string[]
    try {
      names = await fs.readdir(path)
    } catch {
      return
    }
    await Promise.all(names.map((name) => visit(join(path, name))))
  }

  await Promise.all(roots.map(visit))
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

async function fingerprintMatches(expected: ScanFingerprintEntry[]): Promise<boolean> {
  const actual = await Promise.all(expected.map((entry) => fingerprintPath(entry.path)))
  return actual.every((entry, index) => {
    const wanted = expected[index]
    if (wanted.mtimeMs === -1) return entry === null
    return (
      entry !== null &&
      entry.mtimeMs === wanted.mtimeMs &&
      entry.size === wanted.size &&
      entry.directory === wanted.directory
    )
  })
}

async function readScanCache(cacheFile: string): Promise<PluginScanCache | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Partial<PluginScanCache>
    if (
      parsed.version !== SCAN_CACHE_VERSION ||
      typeof parsed.scanKey !== 'string' ||
      !Array.isArray(parsed.fingerprint) ||
      !Array.isArray(parsed.plugins) ||
      parsed.fingerprint.some(
        (entry) =>
          !entry ||
          typeof entry.path !== 'string' ||
          typeof entry.mtimeMs !== 'number' ||
          typeof entry.size !== 'number' ||
          typeof entry.directory !== 'boolean',
      )
    ) {
      return null
    }
    return parsed as PluginScanCache
  } catch {
    return null
  }
}

async function writeScanCache(cacheFile: string, cache: PluginScanCache): Promise<void> {
  try {
    await fs.mkdir(dirname(cacheFile), { recursive: true })
    const temp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`
    await fs.writeFile(temp, JSON.stringify(cache))
    await fs.rename(temp, cacheFile)
  } catch {
    // A read-only install root only loses the optimization; discovery still succeeds.
  }
}

async function scanDirsCached(
  baseDir: string,
  subdirs: string[],
  scope: 'project' | 'global',
  projectId: string,
  opts?: {
    bundledNames?: ReadonlySet<string>
  },
): Promise<DiscoveredPlugin[]> {
  const roots = subdirs.map((sub) => (sub ? join(baseDir, sub) : baseDir))
  const cacheFile = join(baseDir, '.localix', 'cache', SCAN_CACHE_FILE)
  const bundledNames = [...(opts?.bundledNames ?? [])].sort()
  const scanKey = JSON.stringify({
    version: SCAN_CACHE_VERSION,
    roots,
    scope,
    projectId,
    bundledNames,
  })
  const inFlightKey = JSON.stringify([cacheFile, scanKey])
  const existing = scansInFlight.get(inFlightKey)
  if (existing) return existing
  const pending = (async () => {
    const cached = await readScanCache(cacheFile)

    if (
      cached?.scanKey === scanKey &&
      cached.fingerprint.length > 0 &&
      (await fingerprintMatches(cached.fingerprint))
    ) {
      /**
       * Return the mtime/version-keyed cache immediately, then throttle a real scan off
       * the critical path.
       * Keep one validator per cache file; if reality differs it atomically replaces
       * the cache, so the next read cannot keep winning with stale data.
       */
      if (!scanCacheRevalidations.has(cacheFile)) {
        const validation = new Promise<void>((resolveDelay) => {
          const timer = setTimeout(resolveDelay, SCAN_CACHE_REVALIDATE_MS)
          timer.unref?.()
        })
          .then(async () => {
            // Test fixtures and deleted workspaces can disappear before the deferred pass.
            if (!(await fingerprintPath(baseDir))) return
            const actual = await scanDirs(baseDir, subdirs, scope, projectId, opts)
            const fingerprint = await buildScanFingerprint(roots)
            if (
              JSON.stringify(actual) !== JSON.stringify(cached.plugins) ||
              JSON.stringify(fingerprint) !== JSON.stringify(cached.fingerprint)
            ) {
              await writeScanCache(cacheFile, {
                version: SCAN_CACHE_VERSION,
                scanKey,
                fingerprint,
                plugins: actual,
              })
            }
          })
          .finally(() => scanCacheRevalidations.delete(cacheFile))
        scanCacheRevalidations.set(cacheFile, validation)
      }
      return cached.plugins
    }

    // Any version/key/mtime mismatch takes the full-scan path; stale cache data is
    // never returned after a fingerprint mismatch.
    const plugins = await scanDirs(baseDir, subdirs, scope, projectId, opts)
    await writeScanCache(cacheFile, {
      version: SCAN_CACHE_VERSION,
      scanKey,
      fingerprint: await buildScanFingerprint(roots),
      plugins,
    })
    return plugins
  })()
  scansInFlight.set(inFlightKey, pending)
  try {
    return await pending
  } finally {
    if (scansInFlight.get(inFlightKey) === pending) scansInFlight.delete(inFlightKey)
  }
}

/**
 * Discover plugins visible to a scope. Explicit or staged first-party artifacts
 * are synchronized into `~/.localix/plugins` first; an unmarked source-tree
 * fallback is authoring input only and is never copied. Discovery itself then
 * reads only project/global `.localix/plugins` roots.
 */
export async function discoverPlugins(opts: {
  cwd?: string | null
  projectId?: string
  includeBundled?: boolean
  /**
   * The user's home: source of the global `.localix/plugins` scan and where bundled plugins are
   * staged. REQUIRED, decided once at the composition root (`os.homedir()`), a fixture in a test.
   * It had a silent `homedir()` default, and Bun reads the home once per process — so a test that
   * reassigned `HOME`, or passed nothing, staged its fixture plugins into the real
   * `~/.localix/plugins` and read the developer's own installed plugins back.
   */
  homeDir: string
}): Promise<DiscoveredPlugin[]> {
  const home = opts.homeDir
  const projectId = opts.projectId ?? ''
  const includeBundled = opts.includeBundled ?? true
  const absCwd = opts.cwd && opts.cwd !== '/' ? resolve(opts.cwd) : null
  const bundledRoot = includeBundled ? await bundledPluginsSyncRoot() : null
  const bundledNames = bundledRoot ? await syncBundledPlugins(bundledRoot, home) : new Set<string>()

  const projectScan =
    absCwd && absCwd !== home
      ? scanDirsCached(absCwd, PLUGIN_SUBDIRS, 'project', projectId)
      : Promise.resolve([])
  const homeScan = scanDirsCached(home, PLUGIN_SUBDIRS, 'global', '', { bundledNames })
  const [projectPlugins, homePlugins] = await Promise.all([projectScan, homeScan])
  if (!projectId) return mergeByPrecedence([homePlugins])

  // EVERYTHING the user has, project copies first so a repository's own plugin shadows a
  // personal one of the same name.
  //
  // Home plugins used to belong to project-less sessions alone — open a project and your own
  // installed plugins were simply gone, with nothing saying so. That was the last mechanism
  // deciding what you may see from where a file happens to live rather than from a decision
  // you made. What a plugin may DO is a rule on the agent, and an unvetted one is not
  // imported until you allow it, so nothing is loosened by letting you see your own.
  //
  // The state key still follows the active project: a plugin's config and its rules belong to
  // where it is used, which is what keeps two projects from sharing one plugin's settings.
  const homeForProject = homePlugins.map((plugin) => ({ ...plugin, projectId }))
  return mergeByPrecedence([projectPlugins, homeForProject])
}

/**
 * Inspect ONLY first-party source plugins (`plugins/`), in isolation from whatever
 * the developer has installed. {@link discoverPlugins} merges project/global/cc-ecosystem
 * plugins AHEAD of bundled and dedupes by name (first-wins), so a developer who installed a plugin
 * sharing a bundled name shadows its managed copy.
 * The bundled-marketplace generator (`scripts/generate-bundled-marketplace.ts`) and its
 * drift-guard test must see the TRUE bundled set regardless of local installs, so both use
 * this hermetic single-source scan rather than filtering a full merged discovery.
 *
 * Authoring-only source plugins declare `private: true` in their own manifest. Staged builds
 * physically exclude them, while this in-repo scan filters them after generic manifest loading.
 * A copy under ~/.localix/plugins is a normal user installation — the filter is bundled-only.
 *
 * Sorted by name so callers (the marketplace generator writes a committed file) get a
 * deterministic order — `scanDirs` returns in filesystem `readdir` order, which varies
 * across machines and would otherwise churn the generated catalog. `discoverPlugins`
 * applies the same sort via `mergeByPrecedence`.
 */
export async function discoverBundledPlugins(): Promise<DiscoveredPlugin[]> {
  const found = await scanDirs(bundledPluginsRoot(), [''], 'global', '', {
    bundled: true,
  })
  return found.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}

/** The canonical install directory for a scope (global home, or a project dir). */
export function pluginInstallRoot(
  scope: 'global' | 'project',
  cwd: string | null | undefined,
  home: string,
): string {
  const base = scope === 'project' && cwd ? resolve(cwd) : home
  return join(base, '.localix/plugins')
}
