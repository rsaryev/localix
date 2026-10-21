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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const concurrency = process.env.TURBO_CONCURRENCY || '50%'
  const failed = await runConcurrently([
    {
      label: 'packages',
      command: 'bunx',
      args: ['turbo', 'test', 'test:repo:slow', `--concurrency=${concurrency}`],
    },
    { label: 'repository', command: 'bun', args: ['run', 'test:repo'] },
  ])
  if (failed.length) {
    console.error(`[test] Failed: ${failed.join(', ')}`)
    process.exit(1)
  }
}
