#!/usr/bin/env bun
// One timeline for one launch, across every process that writes a Localix log.
//
// The shell (`desktop.log`: its own lines and what the page reports) and the API (`api.log`)
// each write NDJSON under `~/.localix/logs`, both stamped with the launch id the shell hands the
// API. Before that, the two logs lived in different directories in different formats, and a
// startup could not be followed from the window opening to the API answering. This reads both
// (rotated generations included), merges them by time and prints one launch — the last one by
// default.
//
//   bun run logs                  the last launch
//   bun run logs --launches       every launch still in the logs, newest last
//   bun run logs --launch <id>    one launch
//   bun run logs --all            everything, launch or not (development runs have none)
//   bun run logs --source api,ui --level warn --json
//   bun run logs --startup        how long each launch took to reach each milestone, with percentiles
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PINO_LEVELS = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' }
const LEVEL_RANK = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 }
/** Oldest generation first, so a merged read is in write order before the time sort. */
const LOG_FILES = ['desktop.log.old', 'desktop.log', 'api.log.old', 'api.log']

export const defaultLogDir = () => join(homedir(), '.localix', 'logs')

/** One parsed line in the shared shape, or null for a line that is not a log entry. */
export function parseLine(text, file) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || typeof raw.time !== 'number') return null
  const level = typeof raw.level === 'number' ? (PINO_LEVELS[raw.level] ?? 'info') : raw.level
  const {
    time,
    level: _level,
    source,
    launch,
    msg,
    event,
    scope,
    pid: _pid,
    sinceStartMs: _since,
    ...rest
  } = raw
  return {
    time,
    level: typeof level === 'string' ? level : 'info',
    source: source ?? (file.startsWith('api') ? 'api' : 'shell'),
    launch: typeof launch === 'string' ? launch : null,
    text: [scope, event, msg].filter((part) => typeof part === 'string' && part).join(' '),
    rest,
  }
}

export function readEntries(dir = defaultLogDir()) {
  const entries = []
  for (const file of LOG_FILES) {
    const path = join(dir, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const entry = parseLine(line, file)
      if (entry) entries.push(entry)
    }
  }
  return entries.sort((a, b) => a.time - b.time)
}

/** Every launch in the entries: first and last line, and how many warnings and errors. */
export function summarizeLaunches(entries) {
  const launches = new Map()
  for (const entry of entries) {
    if (!entry.launch) continue
    const known = launches.get(entry.launch) ?? {
      launch: entry.launch,
      start: entry.time,
      end: entry.time,
      lines: 0,
      warnings: 0,
      errors: 0,
      sources: new Set(),
    }
    known.end = Math.max(known.end, entry.time)
    known.lines += 1
    known.sources.add(entry.source)
    if (entry.level === 'warn') known.warnings += 1
    if (LEVEL_RANK[entry.level] >= LEVEL_RANK.error) known.errors += 1
    launches.set(entry.launch, known)
  }
  return [...launches.values()].sort((a, b) => a.start - b.start)
}

/** The entries one launch owns: its own lines, in time order. */
export function selectEntries(entries, { launch, all, sources, minLevel }) {
  const rank = LEVEL_RANK[minLevel ?? 'trace'] ?? 0
  return entries.filter(
    (entry) =>
      (all || entry.launch === launch) &&
      (!sources || sources.has(entry.source)) &&
      (LEVEL_RANK[entry.level] ?? 2) >= rank,
  )
}

export function formatEntry(entry, origin) {
  const clock = new Date(entry.time).toISOString().slice(11, 23)
  const offset = origin === undefined ? '' : `+${String(entry.time - origin).padStart(6)}ms  `
  const extra = Object.keys(entry.rest).length ? ` ${JSON.stringify(entry.rest)}` : ''
  return `${clock}  ${offset}${entry.source.padEnd(5)}  ${entry.level.padEnd(5)}  ${entry.text}${extra}`
}

/**
 * The milestones of a launch, in the order they normally happen. Each is the first line whose text
 * matches, measured from `setup entered`, the shell's own start. `ready` is the runtime answering,
 * `paint` the page's first paint, `workspace` the first screen with data, `plugins` the contributed
 * surfaces: the four spans a person waits through, and the ones a slow start shows up in.
 */
const STARTUP_MILESTONES = [
  ['webview', /^webview created/u],
  ['ready', /^runtime ready on port/u],
  ['paint', /shell\.paint/u],
  ['workspace', /workspace\.ready/u],
  ['plugins', /plugins\.ready/u],
]

/** One row per launch that reached `setup entered`: milliseconds to each milestone, or null. */
export function startupTimings(entries) {
  const rows = []
  for (const launch of summarizeLaunches(entries)) {
    const own = entries.filter((entry) => entry.launch === launch.launch)
    const origin = own.find(
      (entry) => entry.source === 'shell' && entry.text.startsWith('setup entered'),
    )
    if (!origin) continue
    const row = { launch: launch.launch, start: origin.time }
    for (const [name, pattern] of STARTUP_MILESTONES) {
      const hit = own.find((entry) => entry.source !== 'api' && pattern.test(entry.text))
      row[name] = hit ? hit.time - origin.time : null
    }
    rows.push(row)
  }
  return rows
}

/** Nearest-rank percentile of `values` (unsorted); undefined when there are none. */
export function percentile(values, p) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return undefined
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

/** `{ metric: { n, p50, p90, max } }` over the rows, for every milestone that has a value. */
export function summarizeStartup(rows) {
  const summary = {}
  for (const [name] of STARTUP_MILESTONES) {
    const values = rows.map((row) => row[name]).filter((value) => value !== null)
    if (values.length === 0) continue
    summary[name] = {
      n: values.length,
      p50: percentile(values, 50),
      p90: percentile(values, 90),
      max: Math.max(...values),
    }
  }
  return summary
}

function printStartup(entries, limit) {
  const rows = startupTimings(entries)
  if (rows.length === 0) {
    console.log('No launch with a `setup entered` line yet.')
    return
  }
  const names = STARTUP_MILESTONES.map(([name]) => name)
  const cell = (value) => (value === null ? '-' : String(value)).padStart(10)
  console.log(
    `${'launch'.padEnd(18)} ${'started'.padEnd(17)}${names.map((name) => name.padStart(10)).join('')}`,
  )
  for (const row of rows.slice(-limit)) {
    const when = new Date(row.start).toISOString().replace('T', ' ').slice(0, 16)
    console.log(
      `${row.launch.padEnd(18)} ${when.padEnd(17)}${names.map((name) => cell(row[name])).join('')}`,
    )
  }
  const summary = summarizeStartup(rows)
  console.log(`\nmilliseconds over ${rows.length} launches:`)
  for (const [label, key] of [
    ['p50', 'p50'],
    ['p90', 'p90'],
    ['max', 'max'],
  ]) {
    console.log(
      `${label.padEnd(36)}${names.map((name) => cell(summary[name]?.[key] ?? null)).join('')}`,
    )
  }
}

function parseArgs(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag)
    return at >= 0 ? argv[at + 1] : undefined
  }
  return {
    dir: value('--dir') ?? defaultLogDir(),
    launch: value('--launch'),
    all: argv.includes('--all'),
    list: argv.includes('--launches'),
    startup: argv.includes('--startup'),
    last: Number(value('--last') ?? 15),
    json: argv.includes('--json'),
    sources: value('--source') ? new Set(value('--source').split(',')) : undefined,
    minLevel: value('--level'),
  }
}

function main(argv) {
  const args = parseArgs(argv)
  const entries = readEntries(args.dir)
  const launches = summarizeLaunches(entries)
  if (args.startup) {
    printStartup(entries, args.last)
    return
  }
  if (args.list) {
    for (const item of launches) {
      const when = new Date(item.start).toISOString().replace('T', ' ').slice(0, 19)
      console.log(
        `${item.launch.padEnd(18)} ${when}  ${String(item.end - item.start).padStart(8)}ms  ` +
          `${String(item.lines).padStart(5)} lines  ${item.warnings} warn  ${item.errors} error  ` +
          `[${[...item.sources].join(',')}]`,
      )
    }
    return
  }
  const launch = args.launch ?? launches.at(-1)?.launch
  if (!args.all && !launch) {
    console.error(`No launch found in ${args.dir}. Use --all to print every line.`)
    process.exitCode = 1
    return
  }
  const selected = selectEntries(entries, { ...args, launch })
  if (args.json) {
    for (const entry of selected) console.log(JSON.stringify(entry))
    return
  }
  if (!args.all) console.log(`launch ${launch} · ${selected.length} lines · ${args.dir}`)
  const origin = args.all ? undefined : selected[0]?.time
  for (const entry of selected) console.log(formatEntry(entry, origin))
}

if (import.meta.main) main(process.argv.slice(2))
