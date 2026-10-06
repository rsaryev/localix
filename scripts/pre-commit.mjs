#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    timeout: 60_000,
    killSignal: 'SIGKILL',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  return result.stdout
}

function gitPaths(args) {
  return run('git', [...args, '-z'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

const staged = gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
const formatted = staged.filter((path) =>
  /\.(?:[cm]?[jt]sx?|jsonc?|mdx?|ya?ml|css|scss|html|toml|graphql)$/.test(path),
)
const rust = staged.some(
  (path) => path.startsWith('apps/desktop-tauri/src-tauri/') && path.endsWith('.rs'),
)
const checked = new Set([
  ...formatted,
  ...(rust ? staged.filter((path) => path.endsWith('.rs')) : []),
])
const partial = gitPaths(['diff', '--name-only']).filter((path) => checked.has(path))
if (partial.length) {
  console.error('[pre-commit] Checks require the staged files to match the working tree. Restage:')
  for (const path of partial) console.error(`  ${path}`)
  process.exit(1)
}

if (formatted.length) {
  console.log(`[pre-commit] Checking formatting of ${formatted.length} staged files`)
  run(join('node_modules', '.bin', 'oxfmt'), ['--check', '--', ...formatted])
}
const sources = formatted.filter((path) => /\.[cm]?[jt]sx?$/.test(path))
if (sources.length) {
  console.log(`[pre-commit] Linting ${sources.length} staged files`)
  run(join('node_modules', '.bin', 'oxlint'), ['--', ...sources])
}
if (rust) {
  const cargo = spawnSync('cargo', ['--version'], { timeout: 5000, killSignal: 'SIGKILL' })
  if (cargo.status === 0) {
    run('cargo', [
      'fmt',
      '--manifest-path',
      'apps/desktop-tauri/src-tauri/Cargo.toml',
      '--',
      '--check',
    ])
  } else {
    console.log('[pre-commit] Cargo unavailable; Rust formatting will be checked in CI')
  }
}
