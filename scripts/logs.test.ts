import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseLine, readEntries, selectEntries, summarizeLaunches } from './logs.mjs'

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
