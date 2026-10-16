#!/usr/bin/env bun
// The CI gates, run before every commit.
//
// Affected-package selection missed failures that only the whole tree shows: a docs edit breaking a
// landing test, a repository guard in scripts/, a test in a package nothing imports. CI caught them
// one push at a time. Turbo caches each task by its inputs, so an unchanged package replays instantly
// and the full run stays short. Rust is still checked only on the host platform (see pre-commit.mjs).
import { runOrExit } from './lib/run.mjs'

const GATES = ['check:release', 'type-check', 'check:tests', 'test']

const unstaged = runOrExit('git', ['diff', '--name-only', '-z'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
  timeout: 60_000,
  killSignal: 'SIGKILL',
})
  .stdout.split('\0')
  .filter(Boolean)
if (unstaged.length) {
  console.error('[pre-commit] The full suite checks the working tree. Stage or stash these first:')
  for (const path of unstaged) console.error(`  ${path}`)
  process.exit(1)
}

for (const gate of GATES) {
  console.log(`[pre-commit] bun run ${gate}`)
  runOrExit('bun', ['run', gate], {
    cwd: process.cwd(),
    stdio: 'inherit',
    timeout: 1_200_000,
    killSignal: 'SIGKILL',
  })
}
console.log('[pre-commit] Full suite passed.')
