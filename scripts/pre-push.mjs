#!/usr/bin/env bun
// The checks a push runs (see pre-push-plan.mjs): types of what the pushed commits change. The
// gates run on the working tree, so it must hold exactly what is pushed: uncommitted tracked
// changes are refused.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runOrExit } from './lib/run.mjs'
import { pushChecks } from './pre-push-plan.mjs'
import { scrubGitEnv } from './scratch-git-env.mjs'

const checks = pushChecks(readFileSync(0, 'utf8'))
if (!checks) process.exit(0)

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

// A remote commit this clone has not fetched cannot be diffed against; main still can.
const known =
  spawnSync('git', ['cat-file', '-e', `${checks.base}^{commit}`], { timeout: 10_000 }).status === 0
// Git exports GIT_DIR and friends to its hooks; nothing the gates start may inherit them. Two tasks
// at a time leave the machine usable; set TURBO_FILTER= (empty) to check everything.
const env = scrubGitEnv({
  TURBO_FILTER: '--affected',
  TURBO_SCM_BASE: known ? checks.base : 'origin/main',
  TURBO_CONCURRENCY: '2',
  ...process.env,
})

for (const gate of checks.gates) {
  console.log(`[pre-push] bun run ${gate}`)
  runOrExit('bun', ['run', gate], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    timeout: 1_200_000,
    killSignal: 'SIGKILL',
  })
}
console.log('[pre-push] Types checked; CI runs the tests.')
