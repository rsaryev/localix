// Single owner of one fact: what `tauri-build` demands already exist on disk before it
// will let ANY cargo command through, and how those things get there.
//
// tauri-build runs as src-tauri's build script and eagerly VALIDATES two entries of
// tauri.conf.json's `bundle` block — long before bundling, so `cargo check` and
// `cargo clippy` hit them too:
//
//   1. externalBin: ["binaries/bun"]  → `binaries/bun-<host-triple>[.exe]` must exist,
//      else: `resource path 'binaries/bun-<triple>' doesn't exist` (exit 101).
//   2. resources: ["resources/**/*"]  → the glob must match ≥1 file,
//      else: `glob pattern resources/**/* path not found or didn't match any files`.
//
// Both are populated by a real desktop build (prepare-sidecar.mjs), which is why the Rust
// tree was un-analysable — and therefore un-gated — on a fresh clone. Keeping that
// knowledge here means the packaging script and the static-analysis gate (check-rust.mjs)
// can never drift on it.
//
// Both target directories are gitignored (`/binaries/`, `/resources/`).
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // apps/desktop-tauri/scripts
export const srcTauri = resolve(here, '..', 'src-tauri')
export const binariesDir = join(srcTauri, 'binaries')
export const resourcesDir = join(srcTauri, 'resources')

/** Host target triple as rustc reports it — the suffix Tauri expects on the sidecar. */
export function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  const m = out.match(/host:\s*(\S+)/)
  if (!m) throw new Error('could not parse rustc host triple')
  return m[1]
}

/** Absolute path Tauri expects the sidecar at, for the current host. */
export function sidecarPath(triple = hostTriple()) {
  const exe = process.platform === 'win32' ? '.exe' : ''
  return join(binariesDir, `bun-${triple}${exe}`)
}

/**
 * Precondition 1 — stage the native Bun runtime as the Tauri sidecar. This is the REAL
 * runtime the packaged app ships (the Bun executing this script unless `source` names another),
 * never a stub.
 * Idempotent unless `force`, so repeat gate runs cost nothing.
 * @returns {{ path: string, staged: boolean }} `staged` = copied just now.
 */
export function stageSidecarBun({ force = false, source = process.execPath } = {}) {
  const dst = sidecarPath()
  if (!force && existsSync(dst)) return { path: dst, staged: false }
  mkdirSync(binariesDir, { recursive: true })
  copyFileSync(source, dst)
  return { path: dst, staged: true }
}

const GATE_MARKER = join(resourcesDir, 'GATE_PLACEHOLDER.txt')

/**
 * Precondition 2, ANALYSIS ONLY — give the `resources/**` glob something to match so
 * tauri-build lets cargo run, WITHOUT paying for a real bundle (which would drag the
 * whole API build, kysely vendoring and four plugin backends into a Rust lint).
 *
 * The marker is a self-describing text file, not a counterfeit artifact: it cannot be
 * mistaken for a staged bundle, and a real build can never ship it because
 * prepare-sidecar.mjs wipes `resources/` before repopulating it. No-op when a real
 * staged bundle is already present.
 */
export function stageGateResourcesMarker() {
  if (existsSync(resourcesDir) && readdirSync(resourcesDir).length > 0) {
    return { path: resourcesDir, staged: false }
  }
  mkdirSync(resourcesDir, { recursive: true })
  writeFileSync(
    GATE_MARKER,
    [
      'Placeholder written by scripts/check-rust.mjs.',
      '',
      'tauri-build refuses to run cargo at all if tauri.conf.json\'s `resources: ["resources/**/*"]`',
      'glob matches no files. The static-analysis gate only needs the Rust source to compile, not a',
      'real bundle, so it drops this marker instead of running the full packaging pipeline.',
      '',
      'This is NOT a build artifact. A real `tauri build` runs scripts/prepare-sidecar.mjs, which',
      'deletes this whole directory and stages the actual server bundle, migrations, plugins,',
      'providers and CLI in its place.',
      '',
    ].join('\n'),
  )
  return { path: GATE_MARKER, staged: true }
}
