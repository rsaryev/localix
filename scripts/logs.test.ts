import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseLine,
  percentile,
  readEntries,
  selectEntries,
  startupTimings,
  summarizeLaunches,
  summarizeStartup,
} from './logs.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function logDir(files: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'localix-logs-'))
  dirs.push(dir)
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(dir, name), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  }
  return dir
}

// A launch could not be followed across the processes that make it up: the shell wrote text to
// the temp dir, the API wrote JSON elsewhere, and nothing tied one line to another's launch.
describe('the merged log', () => {
  test('one launch reads as one timeline across the shell, the page and the API', () => {
    const dir = logDir({
      'desktop.log': [
        { time: 1000, level: 'info', source: 'shell', launch: 'L1', msg: 'launch start' },
        {
          time: 1400,
          level: 'info',
          source: 'ui',
          launch: 'L1',
          scope: 'plugins.ready',
          msg: 'uiMs=440',
        },
        { time: 5000, level: 'info', source: 'shell', launch: 'L2', msg: 'launch start' },
      ],
      'api.log': [
        { time: 1200, level: 30, source: 'api', launch: 'L1', event: 'server.started', port: 5 },
        { time: 1300, level: 50, source: 'api', launch: 'L1', event: 'startup.failed', msg: 'x' },
      ],
    })
    const entries = readEntries(dir)
    const l1 = selectEntries(entries, { launch: 'L1' })
    expect(l1.map((entry) => [entry.source, entry.text])).toEqual([
      ['shell', 'launch start'],
      ['api', 'server.started'],
      ['api', 'startup.failed x'],
      ['ui', 'plugins.ready uiMs=440'],
    ])
    // pino's numeric levels read as the shell's names.
    expect(l1.find((entry) => entry.text.startsWith('startup.failed'))?.level).toBe('error')
  })

  test('launches are listed oldest first, with their warnings and errors counted', () => {
    const dir = logDir({
      'desktop.log': [
        { time: 1, level: 'info', source: 'shell', launch: 'A', msg: 'a' },
        { time: 9, level: 'info', source: 'shell', launch: 'B', msg: 'b' },
      ],
      'api.log': [{ time: 2, level: 50, source: 'api', launch: 'A', event: 'boom' }],
    })
    const launches = summarizeLaunches(readEntries(dir))
    expect(launches.map((item) => [item.launch, item.errors])).toEqual([
      ['A', 1],
      ['B', 0],
    ])
  })

  test('a rotated generation is read before the live file', () => {
    const dir = logDir({
      'api.log.old': [{ time: 1, level: 30, source: 'api', launch: 'A', event: 'older' }],
      'api.log': [{ time: 2, level: 30, source: 'api', launch: 'A', event: 'newer' }],
    })
    expect(readEntries(dir).map((entry) => entry.text)).toEqual(['older', 'newer'])
  })

  test('a line that is not a log entry is skipped, not fatal', () => {
    expect(parseLine('──────── setup start ────────', 'desktop.log')).toBeNull()
    expect(parseLine('{"no":"time"}', 'api.log')).toBeNull()
  })

  test('filters by source and minimum level', () => {
    const dir = logDir({
      'desktop.log': [{ time: 1, level: 'info', source: 'shell', launch: 'A', msg: 'a' }],
      'api.log': [
        { time: 2, level: 30, source: 'api', launch: 'A', event: 'fine' },
        { time: 3, level: 40, source: 'api', launch: 'A', event: 'careful' },
      ],
    })
    const selected = selectEntries(readEntries(dir), {
      launch: 'A',
      sources: new Set(['api']),
      minLevel: 'warn',
    })
    expect(selected.map((entry) => entry.text)).toEqual(['careful'])
  })
})

describe('startup timings', () => {
  const at = (time: number, source: string, text: string, launch: string) => ({
    time,
    level: 'info',
    source,
    launch,
    text,
    rest: {},
  })
  /** A launch whose shell started at `t` and reached each milestone after the given delays. */
  const launch = (id: string, t: number, ms: Record<string, number | null>) =>
    [
      at(t, 'shell', 'setup entered', id),
      ms.webview != null && at(t + ms.webview, 'shell', 'webview created', id),
      ms.ready != null && at(t + ms.ready, 'shell', 'runtime ready on port 5000 after 0.4s', id),
      ms.paint != null && at(t + ms.paint, 'ui', 'startup shell.paint epochMs=1', id),
      ms.workspace != null && at(t + ms.workspace, 'ui', 'startup workspace.ready epochMs=2', id),
      ms.plugins != null && at(t + ms.plugins, 'ui', 'plugins.ready snapshotMs=3', id),
      // The API's own line of the same name must not be taken for the page's.
      at(t + 1, 'api', 'plugins.ready from the api', id),
    ].filter((entry): entry is ReturnType<typeof at> => entry !== false)

  test('measures each milestone from the shell start, per launch', () => {
    const entries = [
      ...launch('a', 1_000, {
        webview: 80,
        ready: 500,
        paint: 400,
        workspace: 1100,
        plugins: 1600,
      }),
      ...launch('b', 9_000, {
        webview: 90,
        ready: 3000,
        paint: 420,
        workspace: 3400,
        plugins: null,
      }),
    ].sort((x, y) => x.time - y.time)
    expect(startupTimings(entries)).toEqual([
      {
        launch: 'a',
        start: 1_000,
        webview: 80,
        ready: 500,
        paint: 400,
        workspace: 1100,
        plugins: 1600,
      },
      {
        launch: 'b',
        start: 9_000,
        webview: 90,
        ready: 3000,
        paint: 420,
        workspace: 3400,
        plugins: null,
      },
    ])
  })

  test('skips a launch with no shell start, such as a development run', () => {
    const entries = [at(5, 'api', 'server.started', 'dev'), ...launch('a', 100, { ready: 400 })]
    expect(startupTimings(entries).map((row) => row.launch)).toEqual(['a'])
  })

  test('summarizes with nearest-rank percentiles and ignores missing values', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50)
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90)
    expect(percentile([5], 90)).toBe(5)
    expect(percentile([null, undefined], 50)).toBeUndefined()
    const rows = [
      { launch: 'a', start: 0, webview: 1, ready: 500, paint: 400, workspace: 1000, plugins: null },
      { launch: 'b', start: 0, webview: 1, ready: 700, paint: 420, workspace: 1200, plugins: null },
      {
        launch: 'c',
        start: 0,
        webview: 1,
        ready: 7000,
        paint: 410,
        workspace: 7300,
        plugins: null,
      },
    ]
    const summary = summarizeStartup(rows)
    expect(summary.ready).toEqual({ n: 3, p50: 700, p90: 7000, max: 7000 })
    expect(summary.plugins).toBeUndefined()
  })
})
