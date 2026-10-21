#!/usr/bin/env bun
// The CI gates, run before every push.
//
// A commit only checks what it stages (pre-commit.mjs) and stays a few seconds; a push checks the
// packages it changes, and CI the whole tree. The gates run on the working tree, so it must
// hold exactly what is pushed: uncommitted tracked changes are refused.
//
// Affected-package selection missed failures that only the whole tree shows: a docs edit breaking a
// landing test, a repository guard in scripts/, a test in a package nothing imports. CI caught them
// one push at a time. Turbo caches each task by its inputs, so an unchanged package replays instantly
// and the full run stays short. Rust is still checked only on the host platform (see pre-commit.mjs).
import { runOrExit } from './lib/run.mjs'
import { scrubGitEnv } from './scratch-git-env.mjs'

const GATES = ['check:release', 'type-check', 'check:tests', 'test']

const uncommitted = runOrExit('git', ['status', '--porcelain', '-z', '--untracked-files=no'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
  timeout: 60_000,
  killSignal: 'SIGKILL',
})
  .stdout.split('\0')
  .filter(Boolean)
if (uncommitted.length) {
  console.error('[pre-push] The gates check the working tree. Commit or stash these first:')
  for (const entry of uncommitted) console.error(`  ${entry}`)
  process.exit(1)
}

// Git exports GIT_DIR and friends to its hooks; nothing the gates start may inherit them.
// Only what this push changes is checked: Turbo's `--affected` selects the packages that differ from
// the remote main and every package that depends on them (all of them when a global input changed).
// CI checks the whole tree before anything reaches main. Three tasks at a time leave the machine
// usable; set TURBO_FILTER= (empty) to check everything, or TURBO_CONCURRENCY to change the width.
const env = scrubGitEnv({
  TURBO_FILTER: '--affected',
  TURBO_SCM_BASE: 'origin/main',
  TURBO_CONCURRENCY: '3',
  ...process.env,
})

for (const gate of GATES) {
  console.log(`[pre-push] bun run ${gate}`)
  runOrExit('bun', ['run', gate], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    timeout: 1_200_000,
    killSignal: 'SIGKILL',
  })
}
console.log('[pre-push] Full suite passed.')
