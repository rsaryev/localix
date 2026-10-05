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

const has = (bin, args) => spawnSync(bin, args, { stdio: 'ignore' }).status === 0

if (!has('cargo', ['--version']) || !has('rustc', ['--version'])) {
  log('SKIP: no Rust toolchain on this machine (cargo/rustc not found).')
  log('      Install Rust (https://rustup.rs) to analyse apps/desktop-tauri/src-tauri.')
  process.exit(0)
}
if (!has('cargo', ['clippy', '--version'])) {
  log('SKIP: clippy missing. Install it with `rustup component add clippy`.')
  process.exit(0)
}

const bun = stageSidecarBun()
log(bun.staged ? `staged Bun sidecar → ${bun.path}` : 'Bun sidecar already staged')
const res = stageGateResourcesMarker()
log(res.staged ? `staged resources marker → ${res.path}` : 'resources/ already populated')

if (has('cargo', ['fmt', '--version'])) {
  log('checking Rust formatting…')
  const format = spawnSync('cargo', ['fmt', '--all', '--', '--check'], {
    cwd: srcTauri,
    stdio: 'inherit',
  })
  if (format.status !== 0) {
    log(`rustfmt failed (exit ${format.status ?? 'signal'})`)
    process.exit(format.status ?? 1)
  }
} else {
  log('SKIP: rustfmt missing. Install it with `rustup component add rustfmt`.')
}

log('running clippy over src-tauri…')
const clippy = spawnSync(
  'cargo',
  ['clippy', '--all-targets', '--locked', '--quiet', '--', '-D', 'warnings'],
  { cwd: srcTauri, stdio: 'inherit' },
)
if (clippy.status !== 0) {
  log(`clippy failed (exit ${clippy.status ?? 'signal'})`)
  process.exit(clippy.status ?? 1)
}

// A release build compiles the updater in (`build.rs`, `LOCALIX_UPDATER_ENABLED=1`), and that code is
// absent from the pass above. Without this pass it would first be compiled by a release leg that has
// already been signed and notarized.
log('running clippy with the updater compiled in (release configuration)…')
const releaseClippy = spawnSync(
  'cargo',
  ['clippy', '--locked', '--quiet', '--', '-D', 'warnings'],
  { cwd: srcTauri, stdio: 'inherit', env: { ...process.env, LOCALIX_UPDATER_ENABLED: '1' } },
)
if (releaseClippy.status !== 0) {
  log(`clippy (release configuration) failed (exit ${releaseClippy.status ?? 'signal'})`)
  process.exit(releaseClippy.status ?? 1)
}

log('running Rust tests…')
const tests = spawnSync('cargo', ['test', '--locked', '--quiet'], {
  cwd: srcTauri,
  stdio: 'inherit',
})
if (tests.status !== 0) {
  log(`Rust tests failed (exit ${tests.status ?? 'signal'})`)
  process.exit(tests.status ?? 1)
}
// The same tests with the updater compiled in: some assert what the page is told in each build.
log('running Rust tests with the updater compiled in…')
const releaseTests = spawnSync('cargo', ['test', '--locked', '--quiet'], {
  cwd: srcTauri,
  stdio: 'inherit',
  env: { ...process.env, LOCALIX_UPDATER_ENABLED: '1' },
})
if (releaseTests.status !== 0) {
  log(`Rust tests (release configuration) failed (exit ${releaseTests.status ?? 'signal'})`)
  process.exit(releaseTests.status ?? 1)
}
log('clean.')
