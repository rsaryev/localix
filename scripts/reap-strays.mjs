#!/usr/bin/env bun
/**
 * Find (and with `--kill`, stop) the processes a development session leaves behind in this
 * repository.
 *
 * The defect: a session ends or a command is interrupted, and what it started keeps running — a
 * `bun test` hung at full CPU, a headless Chrome from a screenshot check, a Vite server on a
 * scratch port. Nothing owns them any more, so nothing stops them, and the machine slows to a crawl
 * until someone finds them in the process list.
 *
 * Three rules, each narrow enough to never touch a real dev session:
 *   1. a `bun test` process older than {@link TEST_MAX_S} — past the in-process deadline
 *      (`test-deadline.ts`), so it is stuck, however it was launched;
 *   2. a HEADLESS Chrome using a scratch profile (`--user-data-dir` under a temp dir) older than
 *      {@link BROWSER_MAX_S} — the user's own browser is never headless;
 *   3. an ORPHAN (re-parented to launchd, ppid 1) bun/node/vite/esbuild whose command line points
 *      into this repository or an agent scratch dir, older than {@link ORPHAN_MIN_S}. `bun run dev`
 *      keeps its children parented, so its servers never match.
 *
 * Usage: `bun scripts/reap-strays.mjs` (report) · `--kill` (stop them) · `--quiet` (no output when
 * nothing matched — the form a session-end hook runs).
 */
import { execFileSync } from 'node:child_process'

import { repoRoot as getRepoRoot } from './lib/paths.mjs'

export const TEST_MAX_S = 20 * 60
export const BROWSER_MAX_S = 20 * 60
export const ORPHAN_MIN_S = 5 * 60

/** `ps` elapsed time (`[[dd-]hh:]mm:ss`) → seconds. */
export function elapsedSeconds(etime) {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime]
  const parts = rest.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  const [h, m, s] = parts
  return Number(days) * 86_400 + h * 3_600 + m * 60 + s
}

/** Parse `ps -Ao pid=,ppid=,etime=,command=` output. */
export function parsePs(text) {
  return text
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, etime, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      age: elapsedSeconds(etime),
      command,
    }))
}

const SCRATCH = /\/(?:private\/)?(?:tmp|var\/folders)\/|\/claude-\d+\//
const DEV_TOOL = /(?:^|\/)(?:bun|node|vite|esbuild)(?:\s|$)|\/node_modules\/\.bin\/(?:vite|esbuild)/

/** The stray processes in `rows`, each with the rule it matched. Never `exclude` (self, parents). */
export function selectStrays(rows, { repoRoot, exclude = new Set() }) {
  const strays = []
  for (const row of rows) {
    if (exclude.has(row.pid)) continue
    const { command, age } = row
    if (/(?:^|\/)bun\s+(?:x\s+)?test(?:\s|$)/.test(command) && age > TEST_MAX_S) {
      strays.push({ ...row, rule: 'stuck bun test' })
    } else if (
      // The browser process only; its helpers exit with it.
      /Google Chrome(?: for Testing)?(?:\.app)?\/Contents\/MacOS\/Google Chrome(?! Helper)\b/.test(
        command,
      ) &&
      /--headless/.test(command) &&
      /--user-data-dir=\S*/.test(command) &&
      SCRATCH.test(/--user-data-dir=(\S*)/.exec(command)?.[1] ?? '') &&
      age > BROWSER_MAX_S
    ) {
      strays.push({ ...row, rule: 'abandoned headless browser' })
    } else if (
      row.ppid === 1 &&
      age > ORPHAN_MIN_S &&
      DEV_TOOL.test(command) &&
      (command.includes(repoRoot) || SCRATCH.test(command))
    ) {
      strays.push({ ...row, rule: 'orphaned dev process' })
    }
  }
  return strays
}

function ancestors(pid, rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const chain = new Set([pid])
  let current = byPid.get(pid)
  while (current && current.ppid > 1 && !chain.has(current.ppid)) {
    chain.add(current.ppid)
    current = byPid.get(current.ppid)
  }
  return chain
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const root = getRepoRoot()
  const rows = parsePs(
    execFileSync('ps', ['-Ao', 'pid=,ppid=,etime=,command='], { encoding: 'utf8' }),
  )
  const strays = selectStrays(rows, { repoRoot: root, exclude: ancestors(process.pid, rows) })
  if (strays.length === 0) {
    if (!args.has('--quiet')) console.log('reap-strays: nothing stray.')
    return
  }
  const kill = args.has('--kill')
  for (const stray of strays) {
    const minutes = Math.round(stray.age / 60)
    console.log(
      `reap-strays: ${kill ? 'stopping' : 'found'} ${stray.rule} — pid ${stray.pid}, ${minutes} min: ${stray.command.slice(0, 140)}`,
    )
    if (kill) {
      try {
        process.kill(stray.pid, 'SIGTERM')
      } catch {}
    }
  }
  if (!kill) {
    console.log('reap-strays: run with --kill to stop them.')
    return
  }
  await Bun.sleep(2_000)
  for (const stray of strays) {
    try {
      process.kill(stray.pid, 0)
      process.kill(stray.pid, 'SIGKILL')
    } catch {}
  }
}

if (import.meta.main) await main()
