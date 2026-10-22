#!/usr/bin/env bun
// Run one package's tests in N processes, each taking every Nth file (`bun test --shard=i/N`).
//
// `bun test --parallel` isolates every file in a fresh global, so each of a thousand files loads
// and transpiles the whole module graph again: measured on apps/api's chat tests, 4 isolated
// workers spent 4x the CPU of one serial run for a small gain in wall time, and heated the
// machine. A shard is an ordinary `bun test` process: it loads the graph once and runs its files in
// sequence, as a serial run does, so the same files pass. 4 shards: 2.5x faster than serial at
// 1.4x its CPU.
//
//   bun ../../scripts/test-shards.mjs <shards> [bun test arguments…]
import { pathToFileURL } from 'node:url'

import { runConcurrently } from './test-all.mjs'

/**
 * @param {number} shards
 * @param {string[]} args the `bun test` arguments every shard shares
 */
export function shardCommands(shards, args) {
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`Invalid shard count "${shards}"`)
  return Array.from({ length: shards }, (_, index) => ({
    label: `shard ${index + 1}/${shards}`,
    command: process.execPath,
    args: ['test', `--shard=${index + 1}/${shards}`, ...args],
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [count, ...args] = process.argv.slice(2)
  const failed = await runConcurrently(shardCommands(Number(count), args), { cwd: process.cwd() })
  if (failed.length) {
    console.error(`[test] Failed: ${failed.join(', ')}`)
    // `exitCode`, not `exit()`: a buffered shard's output is one large write to a pipe, and
    // exiting at once cut it off — the failures it named never reached the log.
    process.exitCode = 1
  }
}
