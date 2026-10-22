#!/usr/bin/env bun
// The whole test suite: the workspace packages through Turbo and the repository tests beside them.
//
// The two share nothing, so they run at once. Run one after the other, the repository tests added
// minutes to every CI run and pre-commit while Turbo left half the cores idle (it runs at 50%). The
// first command streams; the others are buffered and printed whole when they finish, so the log
// never interleaves two runners' lines.
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { repoRoot } from './lib/paths.mjs'

/**
 * Run every command at once and resolve to the failed ones' labels.
 *
 * @param {{ label: string, command: string, args: string[] }[]} commands
 * @param {{ cwd?: string, write?: (text: string) => void }} [options]
 * @returns {Promise<string[]>}
 */
export async function runConcurrently(commands, options = {}) {
  const cwd = options.cwd ?? repoRoot()
  const write = options.write ?? ((text) => process.stdout.write(text))
  const children = []
  const forward = (signal) => {
    for (const child of children) child.kill(signal)
  }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  try {
    const results = await Promise.all(
      commands.map(({ label, command, args }, index) => {
        const streamed = index === 0
        const child = spawn(command, args, {
          cwd,
          env: process.env,
          stdio: streamed ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        })
        children.push(child)
        let output = ''
        child.stdout?.on('data', (chunk) => (output += chunk))
        child.stderr?.on('data', (chunk) => (output += chunk))
        return new Promise((resolve) => {
          child.on('error', (error) => resolve({ label, ok: false, output: `${error}\n` }))
          child.on('close', (code) => resolve({ label, ok: code === 0, output }))
        })
      }),
    )
    for (const { label, ok, output } of results.slice(1)) {
      write(`\n[test] ${label} (${ok ? 'passed' : 'failed'})\n${output}`)
    }
    return results.filter((result) => !result.ok).map((result) => result.label)
  } finally {
    process.off('SIGINT', forward)
    process.off('SIGTERM', forward)
  }
}

/**
 * The commands for one slice of the suite. `unit` is every package's `test` (fast, parallel);
 * `system` is what drives real processes or walks the repository: each package's
 * `test:integration`, the cached slow repository tests and the repository guards. CI runs the
 * two slices as separate jobs; a local `bun run test` runs both at once.
 *
 * @param {'all' | 'unit' | 'system'} slice
 * @param {{ concurrency?: string, filter?: string[] }} [options]
 */
export function suiteCommands(slice, { concurrency = '50%', filter = [] } = {}) {
  const tasks = {
    all: ['test', 'test:integration', 'test:repo:slow'],
    unit: ['test'],
    system: ['test:integration', 'test:repo:slow'],
  }[slice]
  if (!tasks) throw new Error(`Unknown test slice "${slice}": use unit, system or all`)
  const commands = [
    {
      label: 'packages',
      command: 'bunx',
      args: ['turbo', ...tasks, `--concurrency=${concurrency}`, ...filter],
    },
  ]
  // The repository guards read every source file while the packages' suites load the machine;
  // `test:repo` gives each guard 60 s for that, where bun's default 5 s timed them out.
  if (slice !== 'unit')
    commands.push({ label: 'repository', command: 'bun', args: ['run', 'test:repo'] })
  return commands
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // `--affected` (set by pre-push and pull-request CI) runs only the packages a change reaches.
  const failed = await runConcurrently(
    suiteCommands(/** @type {'all' | 'unit' | 'system'} */ (process.argv[2] ?? 'all'), {
      concurrency: process.env.TURBO_CONCURRENCY || '50%',
      filter: (process.env.TURBO_FILTER ?? '').split(' ').filter(Boolean),
    }),
  )
  if (failed.length) {
    console.error(`[test] Failed: ${failed.join(', ')}`)
    process.exit(1)
  }
}
