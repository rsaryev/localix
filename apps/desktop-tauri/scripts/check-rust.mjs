// The desktop shell's Rust gate: formatting, Clippy, and tests over src-tauri from a fresh clone.
//
// Why it exists: apps/desktop-tauri is deliberately kept out of turbo's build/dev/lint
// tasks (see the `//` notes in package.json — a bare `build` task would run on machines
// without Rust and fail), so this dedicated task keeps the native tree in the validation graph
// without making Rust a prerequisite for ordinary JavaScript workspace tasks.
//
// Why it isn't just `cargo clippy`: tauri-build validates two tauri.conf.json paths at
// build-script time, so a bare clippy exits 101 on any machine that has never run a
// desktop build. A gate with a manual precondition is a gate people learn to ignore, so
// this script satisfies both preconditions itself — see scripts/tauri-staging.mjs, which
// also owns the real packaging path, so the two can't drift.
//
// Rust is an optional local toolchain, so a machine without it SKIPS loudly and exits 0
// rather than going permanently red — the one thing this gate must never be.
import { spawnSync } from 'node:child_process'
import { stageGateResourcesMarker, stageSidecarBun, srcTauri } from './tauri-staging.mjs'

const log = (...a) => console.log('[check-rust]', ...a)
const lintOnly = process.argv.includes('--lint-only')

const has = (bin, args) => spawnSync(bin, args, { stdio: 'ignore' }).status === 0

if (!has('cargo', ['--version']) || !has('rustc', ['--version'])) {
  log('SKIP: no Rust toolchain on this machine (cargo/rustc not found).')
  log('      Install Rust (https://rustup.rs) to analyse apps/desktop-tauri/src-tauri.')
  process.exit(lintOnly ? 1 : 0)
}
if (!has('cargo', ['clippy', '--version'])) {
  log('SKIP: clippy missing. Install it with `rustup component add clippy`.')
  process.exit(lintOnly ? 1 : 0)
}

const bun = stageSidecarBun()
log(bun.staged ? `staged Bun sidecar → ${bun.path}` : 'Bun sidecar already staged')
const res = stageGateResourcesMarker()
log(res.staged ? `staged resources marker → ${res.path}` : 'resources/ already populated')

/** Runs one cargo step in src-tauri; a failure ends the gate with cargo's own exit code. */
function cargo(failure, args, env) {
  const result = spawnSync('cargo', args, {
    cwd: srcTauri,
    stdio: 'inherit',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  })
  if (result.status !== 0) {
    log(`${failure} failed (exit ${result.status ?? 'signal'})`)
    process.exit(result.status ?? 1)
  }
}
const release = { LOCALIX_UPDATER_ENABLED: '1' }
const clippyArgs = ['--locked', '--quiet', '--', '-D', 'warnings']

if (has('cargo', ['fmt', '--version'])) {
  log('checking Rust formatting…')
  cargo('rustfmt', ['fmt', '--all', '--', '--check'])
} else {
  log('SKIP: rustfmt missing. Install it with `rustup component add rustfmt`.')
  if (lintOnly) process.exit(1)
}

log('running clippy over src-tauri…')
cargo('clippy', ['clippy', '--all-targets', ...clippyArgs])

// A release build compiles the updater in (`build.rs`, `LOCALIX_UPDATER_ENABLED=1`), and that code is
// absent from the pass above. Without this pass it would first be compiled by a release leg that has
// already been signed and notarized.
log('running clippy with the updater compiled in (release configuration)…')
cargo('clippy (release configuration)', ['clippy', ...clippyArgs], release)
if (lintOnly) {
  log('formatting and Clippy passed.')
  process.exit(0)
}

log('running Rust tests…')
cargo('Rust tests', ['test', '--locked', '--quiet'])
// The same tests with the updater compiled in: some assert what the page is told in each build.
log('running Rust tests with the updater compiled in…')
cargo('Rust tests (release configuration)', ['test', '--locked', '--quiet'], release)
log('clean.')
