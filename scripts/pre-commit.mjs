#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { runOrExit } from './lib/run.mjs'
import { scrubGitEnv } from './scratch-git-env.mjs'
import { isGlobalTypeInput, isInWorkspace, planChecks, readWorkspaces } from './pre-commit-plan.mjs'

// Git exports GIT_DIR, GIT_INDEX_FILE and friends to its hooks. Only this hook's own git calls
// need them (to see the index being committed); a tool or test started here must not inherit a
// pointer to this repository.
const toolEnv = scrubGitEnv({ ...process.env })

function run(command, args, options = {}) {
  // The hook runs in whichever checkout invoked it, not necessarily the one this file lives in.
  return runOrExit(command, args, {
    cwd: process.cwd(),
    env: command === 'git' ? process.env : toolEnv,
    stdio: 'inherit',
    timeout: 60_000,
    killSignal: 'SIGKILL',
    ...options,
  }).stdout
}

function gitPaths(args) {
  return run('git', [...args, '-z'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

const staged = gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
const changed = gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACMRD'])
const plan = planChecks(changed, readWorkspaces(process.cwd()))
const typeScope = plan.typed.length
  ? plan.typed.map((workspace) => workspace.name).join(', ')
  : 'skipped (no typed package changes)'
const rustScope = plan.rust ? process.platform : 'skipped (no native changes)'
console.log(
  `[pre-commit] Scope: types=${typeScope}; Rust=${rustScope}; tests=${plan.tests.length} files`,
)
const formatted = staged.filter((path) =>
  /\.(?:[cm]?[jt]sx?|jsonc?|mdx?|ya?ml|css|scss|html|toml|graphql)$/.test(path),
)
const checked = new Set([
  ...formatted,
  ...plan.tests,
  ...(plan.rust ? staged.filter((path) => path.endsWith('.rs')) : []),
])
const partial = gitPaths(['diff', '--name-only']).filter(
  (path) =>
    checked.has(path) ||
    (plan.typed.length &&
      (plan.allTypes ||
        isGlobalTypeInput(path) ||
        plan.affected.some((workspace) => isInWorkspace(workspace, path)))) ||
    (plan.rust && path.startsWith('apps/desktop-tauri/src-tauri/')),
)
if (partial.length) {
  console.error('[pre-commit] Checks require the staged files to match the working tree. Restage:')
  for (const path of partial) console.error(`  ${path}`)
  process.exit(1)
}

if (formatted.length) {
  console.log(`[pre-commit] Checking formatting of ${formatted.length} staged files`)
  // Migrations and other formatter-ignored files may be all a commit stages: that is no error.
  run(join('node_modules', '.bin', 'oxfmt'), [
    '--check',
    '--no-error-on-unmatched-pattern',
    '--',
    ...formatted,
  ])
}
const sources = formatted.filter((path) => /\.[cm]?[jt]sx?$/.test(path))
if (sources.length) {
  console.log(`[pre-commit] Linting ${sources.length} staged files`)
  run(join('node_modules', '.bin', 'oxlint'), ['--', ...sources])
}
if (plan.typed.length) {
  console.log(
    `[pre-commit] Checking source and test types in ${plan.typed.length} affected packages`,
  )
  run(
    join('node_modules', '.bin', 'turbo'),
    [
      'type-check',
      'type-check:tests',
      '--concurrency=2',
      ...plan.typed.map((workspace) => `--filter=${workspace.name}`),
    ],
    { timeout: 600_000 },
  )
}
if (plan.tests.length) {
  console.log(`[pre-commit] Running ${plan.tests.length} changed or co-located test files`)
  // Each workspace runs its own files from its own directory: Bun reads bunfig.toml only where a
  // run starts, so a package's preloads (DOM warm-up, mocks, guards) apply only from there.
  const workspaces = readWorkspaces(process.cwd()).sort((a, b) => b.path.length - a.path.length)
  const byOwner = new Map()
  for (const path of plan.tests) {
    const owner = workspaces.find((workspace) => isInWorkspace(workspace, path))?.path ?? '.'
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), path])
  }
  for (const [owner, files] of byOwner) {
    const local = files.map((path) => `./${owner === '.' ? path : path.slice(owner.length + 1)}`)
    // Each file in its own module graph, as the suite promises (`docs/internals/testing.md`): a DOM
    // file whose Radix bound after another file released the preload's DOM renders no dialogs.
    run('bun', ['test', '--isolate', ...local], {
      cwd: join(process.cwd(), owner),
      timeout: 300_000,
    })
  }
}
if (plan.rust) {
  const cargo = spawnSync('cargo', ['--version'], { timeout: 5000, killSignal: 'SIGKILL' })
  if (cargo.status === 0) {
    console.log('[pre-commit] Checking Rust formatting and Clippy on the current platform')
    run('bun', ['apps/desktop-tauri/scripts/check-rust.mjs', '--lint-only'], { timeout: 900_000 })
  } else {
    console.log('[pre-commit] Cargo unavailable; Rust formatting and Clippy will be checked in CI')
  }
}
console.log('[pre-commit] Selected checks passed.')
