// Runs several commands at once, as `scripts/test-shards.mjs` runs a package's shards. The first
// command streams; the others are buffered and printed whole when they finish, so the log never
// interleaves two runners' lines. The suite itself runs through Turbo: `bun run test` and
// `bun run test:integration`.
import { spawn } from 'node:child_process'

import { repoRoot } from './lib/paths.mjs'

/**
 * How much of a buffered command's output is kept: its last 4 MiB. A test that printed without
 * end (a focus loop overflowing the stack and printing the trace, over and over) grew one string
 * until the runner died of "Out of memory" inside its `data` handler; that command's promise then
 * never settled and the whole run hung long after its test processes were gone.
 */
export const MAX_BUFFERED_OUTPUT_BYTES = 4 * 1024 * 1024

/**
 * The newest `limit` bytes of a stream, with a line saying how much came before them.
 *
 * @param {number} limit
 */
function outputTail(limit) {
  /** @type {Buffer[]} */
  let chunks = []
  let kept = 0
  let dropped = 0
  return {
    /** @param {Buffer | string} chunk */
    add: (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(bytes)
      kept += bytes.length
      if (kept <= 2 * limit) return
      const joined = Buffer.concat(chunks)
      const cut = joined.length - limit
      dropped += cut
      chunks = [joined.subarray(cut)]
      kept = limit
    },
    text: () => {
      const all = Buffer.concat(chunks)
      const cut = Math.max(0, all.length - limit)
      const total = dropped + cut
      const tail = all.subarray(cut).toString('utf8')
      return total ? `[test] ${total} earlier bytes of output were dropped\n${tail}` : tail
    },
  }
}

/**
 * Run every command at once and resolve to the failed ones' labels.
 *
 * @param {{ label: string, command: string, args: string[] }[]} commands
 * @param {{ cwd?: string, write?: (text: string) => void, maxOutputBytes?: number }} [options]
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
        const output = outputTail(options.maxOutputBytes ?? MAX_BUFFERED_OUTPUT_BYTES)
        child.stdout?.on('data', output.add)
        child.stderr?.on('data', output.add)
        return new Promise((resolve) => {
          child.on('error', (error) => resolve({ label, ok: false, output: `${error}\n` }))
          child.on('close', (code) => resolve({ label, ok: code === 0, output: output.text() }))
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
