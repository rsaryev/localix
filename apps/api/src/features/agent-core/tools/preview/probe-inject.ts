/**
 * Visual-feedback probe — server-side bundling + HTML injection.
 *
 * The probe ships as source in `@localixai/visual-feedback/probe-entry`. We bundle
 * it ONCE to a minified browser IIFE with `Bun.build` and cache the string in module
 * scope (the static preview server is process-wide, so this is shared across
 * sessions). The probe is injected INLINE into HTML we serve (same origin as the
 * preview, no CORS), and it talks to the host UI window via postMessage.
 *
 * Always injected: the probe is inert until the host activates comment mode, so
 * there is nothing to gate it on.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { errorMessage } from '../../../../lib/errors'

// ─── Probe build + dev-aware cache ───────────────────────────────────────────
//
// The probe is bundled ONCE with `Bun.build` and cached process-wide. That cache is
// correct in PRODUCTION (the source never changes), but a real DX trap in DEVELOPMENT:
// the apps/api dev script is `bun --watch src/index.ts`, and `--watch` only rebuilds
// the STATIC import graph of `src/index.ts`. The probe is built DYNAMICALLY (via
// `Bun.resolveSync` + `Bun.build`), so it isn't in that graph — a code change under
// `packages/visual-feedback/src/**` does NOT rebuild it and the running server keeps
// serving a STALE probe until a full manual restart (a landed preview fix
// looked un-landed because the live server never picked up the new probe).
//
// Guard the cache on a content fingerprint of visual-feedback source: rebuild whenever
// that tree changes. `sourceVersion()` returns null outside dev-watch — and when the
// source can't be read (a bundled/dist install has no `src`) — so PRODUCTION keeps the old build-once,
// cache-forever behavior (no extra I/O, no rebuild). Dev sees an edit on the next
// preview open with no manual restart.

let probeCache: string | null = null
let building: Promise<string> | null = null
/** Source fingerprint the current `probeCache` was built from (`null` outside dev-watch). */
let cacheSourceVersion: string | null = null
let nativeProbeCache: { version: string | null; js: string } | null = null
let warnedProbeBuildFailure = false

/**
 * A packaged API bundle carries the already-built browser probe beside its server
 * entry. Reading that asset keeps installed CLI/Desktop runtimes self-contained:
 * they must not ask Bun to resolve (or auto-install) a workspace package on boot.
 * Source/watch runs have no sibling asset and retain the live Bun.build path below.
 */
export function resolvePrebuiltProbeFile(
  baseDir: string = import.meta.dir,
  exists: (file: string) => boolean = fs.existsSync,
): string | null {
  const file = path.join(baseDir, 'visual-feedback-probe.js')
  return exists(file) ? file : null
}

/**
 * Resolve the probe entry module to bundle. Published installs resolve the package's
 * compiled `dist/probe/entry.js`. In a workspace checkout we deliberately prefer the
 * sibling `src/probe/entry.ts`, so dev edits are bundled immediately and observed by
 * the source fingerprint below. Only when neither export nor dist fallback resolves do we
 * rethrow — that error must stay loud at the call sites (see `injectProbeIntoHtml`).
 */
export function resolveProbeEntry(
  resolve: (specifier: string) => string = (s) => Bun.resolveSync(s, import.meta.dir),
  exists: (file: string) => boolean = fs.existsSync,
): string {
  try {
    const packageManifest = resolve('@localixai/visual-feedback/package.json')
    const sourceEntry = path.join(path.dirname(packageManifest), 'src', 'probe', 'entry.ts')
    if (exists(sourceEntry)) return sourceEntry
  } catch {
    /* published/export-only layouts fall through to the public compiled entry */
  }
  try {
    const resolvedEntry = resolve('@localixai/visual-feedback/probe-entry')
    const distMarker = `${path.sep}dist${path.sep}`
    const distIndex = resolvedEntry.lastIndexOf(distMarker)
    if (distIndex >= 0) {
      const sourceEntry = path.join(resolvedEntry.slice(0, distIndex), 'src', 'probe', 'entry.ts')
      if (exists(sourceEntry)) return sourceEntry
    }
    return resolvedEntry
  } catch (err) {
    try {
      // Package main resolves to `dist/index.js`; the compiled probe entry is its sibling.
      const pkgMain = resolve('@localixai/visual-feedback')
      const distEntry = path.join(path.dirname(pkgMain), 'probe', 'entry.js')
      if (exists(distEntry)) return distEntry
    } catch {
      /* fall through to the original, more precise error */
    }
    throw err
  }
}

/** One probe entry as a minified browser IIFE — the shape both probes ship in. */
async function bundleProbe(entry: string, name: string): Promise<string> {
  const out = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: true,
  })
  if (!out.success) throw new Error(`${name} build failed: ${out.logs.map(String).join('; ')}`)
  return out.outputs[0].text()
}

async function buildProbe(): Promise<string> {
  const prebuilt = resolvePrebuiltProbeFile()
  if (prebuilt) return fs.promises.readFile(prebuilt, 'utf8')
  return bundleProbe(resolveProbeEntry(), 'visual-feedback probe')
}

/**
 * True under `bun --watch` / `bun --hot` — the only mode where the visual-feedback
 * source can change under a running server. Bun surfaces its runtime flags on
 * `process.execArgv` (verified: `["--watch"]` under watch, `[]` on a normal run and
 * under `bun test`).
 */
function isDevWatch(): boolean {
  return process.execArgv.includes('--watch') || process.execArgv.includes('--hot')
}

// The visual-feedback package `src` dir, resolved once (the location never changes at
// runtime). `null` when it can't be located/statted — a bundled/published install
// resolves probe-entry into `dist`, which has no adjacent `src` tree.
let srcDirResolved = false
let srcDir: string | null = null
function probeSourceDir(): string | null {
  if (srcDirResolved) return srcDir
  srcDirResolved = true
  try {
    // Workspace resolution prefers `<pkg>/src/probe/entry.ts`. Walk up to the `src` ROOT so
    // an edit to ANY sibling (actuate/, snapshot/, protocol/, …) is seen — not just
    // probe/. Those siblings are exactly where preview fixes land.
    const entry = resolveProbeEntry()
    const marker = `${path.sep}src${path.sep}`
    const idx = entry.lastIndexOf(marker)
    const dir = idx >= 0 ? entry.slice(0, idx + marker.length - 1) : path.dirname(entry)
    srcDir = fs.existsSync(dir) ? dir : null
  } catch {
    srcDir = null
  }
  return srcDir
}

/**
 * Content fingerprint that should invalidate the probe cache, or `null` to hold the
 * cache (production/dist, or the source tree can't be read). Dev-watch only —
 * production returns null immediately with zero I/O. A scan failure returns null (hold
 * the cache) rather than crashing a preview.
 */
function defaultSourceVersion(): string | null {
  if (!isDevWatch()) return null
  const dir = probeSourceDir()
  if (!dir) return null
  try {
    // The probe bundles from `.ts` source only (no .tsx in this package). Test files
    // don't ship in the probe, so editing one shouldn't force a rebuild.
    const files = [...new Bun.Glob('**/*.ts').scanSync({ cwd: dir, onlyFiles: true })]
      .filter((rel) => !rel.includes('.test.') && !rel.includes('.bench.'))
      .sort()
    const hash = createHash('sha256')
    for (const rel of files) {
      hash
        .update(rel)
        .update('\0')
        .update(fs.readFileSync(path.join(dir, rel)))
        .update('\0')
    }
    return hash.digest('hex')
  } catch {
    return null // never let a scan/read race break a preview — hold the cache
  }
}

/** Injectable seams for `getPreviewProbeJs` (tests supply fakes; production uses the
 *  real `Bun.build` bundle + the source-version guard). */
export interface ProbeCacheDeps {
  build: () => Promise<string>
  /** Dev source fingerprint; null holds the cache permanently. */
  sourceVersion: () => string | null
}

/**
 * Memoized probe IIFE source. Concurrent callers share one in-flight build. Rebuilds
 * when the visual-feedback source changed since the cached build — dev-watch only, so
 * `sourceVersion()` is null in production and the cache is permanent there.
 */
export async function getPreviewProbeJs(deps: Partial<ProbeCacheDeps> = {}): Promise<string> {
  const build = deps.build ?? buildProbe
  const sourceVersion = deps.sourceVersion ?? defaultSourceVersion

  const version = sourceVersion()
  // Source differs from the cached build → drop the stale cache so we rebuild below.
  // Guarded on a LIVE cache, so a cold start or an in-flight first build is never
  // interrupted (an edit during that window is caught on the next call).
  if (probeCache != null && version != null && version !== cacheSourceVersion) {
    probeCache = null
    building = null
  }
  if (probeCache != null) return probeCache

  if (!building) {
    building = build()
      .then((js) => {
        probeCache = js
        cacheSourceVersion = version
        return js
      })
      .catch((err) => {
        building = null
        throw err
      })
  }
  return building
}

/** The system-webview bridge bundles the same actuator without the iframe transport. */
export async function getNativeBrowserProbeJs(): Promise<string> {
  const version = defaultSourceVersion()
  if (nativeProbeCache && (version === null || nativeProbeCache.version === version))
    return nativeProbeCache.js
  const prebuilt = path.join(import.meta.dir, 'visual-feedback-native-probe.js')
  const js = fs.existsSync(prebuilt)
    ? await fs.promises.readFile(prebuilt, 'utf8')
    : // Its entry sits beside the iframe probe's, in whichever layout (src or dist) resolved.
      await bundleProbe(
        resolveProbeEntry().replace(/entry\.(ts|js)$/, 'native-entry.$1'),
        'native browser probe',
      )
  nativeProbeCache = { version, js }
  return js
}

/**
 * Reset the probe cache so the next `getPreviewProbeJs()` rebuilds. A clean seam for
 * tests and any future explicit dev-watch hook (the source-version guard handles the
 * common dev-edit case automatically).
 */
export function invalidatePreviewProbe(): void {
  probeCache = null
  building = null
  cacheSourceVersion = null
}

/** Fire-and-forget warm-up so the first preview request isn't blocked on a cold build. */
export function warmPreviewProbe(): void {
  void getPreviewProbeJs().catch(() => {
    /* logged on first real use */
  })
}

/** HTML-attribute escaping — shared with the proxy's "starting…" page. */
export function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Inject the probe inline into an HTML document, before `</head>` (or prepended if
 * there's no head). `servedFile` is stamped on the script so the probe can attribute
 * picks to the file we're serving (the strongest source signal for static previews).
 */
export async function injectProbeIntoHtml(
  html: string,
  opts: { servedFile?: string } = {},
): Promise<string> {
  let js: string
  try {
    js = await getPreviewProbeJs()
  } catch (err) {
    // Never break a preview because the probe failed to build — but don't degrade
    // SILENTLY either: warn once so a broken element-picker is diagnosable.
    if (!warnedProbeBuildFailure) {
      warnedProbeBuildFailure = true
      console.warn(
        '[preview] visual-feedback probe failed to build — previews will lack the element picker / agent control:',
        errorMessage(err),
      )
    }
    return html
  }
  const fileAttr = opts.servedFile ? ` data-vf-file="${escapeAttr(opts.servedFile)}"` : ''
  // Escape any literal `</script` in the bundle so it can't prematurely close the
  // inline tag and break the page. `<\/script` is identical to `</script` inside a
  // JS string/regex, so the probe's behavior is unchanged.
  const safeJs = js.replace(/<\/script/gi, '<\\/script')
  const tag = `<script data-vf-probe${fileAttr}>${safeJs}</script>`
  const lower = html.toLowerCase()
  // Prefer the FIRST </head> (the document head); fall back to </body>; otherwise
  // append (running after content is fine — the probe guards on readyState). Never
  // prepend before the doctype, which would flip the page into quirks mode.
  const headEnd = lower.indexOf('</head>')
  if (headEnd !== -1) return html.slice(0, headEnd) + tag + html.slice(headEnd)
  const bodyEnd = lower.indexOf('</body>')
  if (bodyEnd !== -1) return html.slice(0, bodyEnd) + tag + html.slice(bodyEnd)
  return html + tag
}
