import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { foldJsonlFrom, jsonlRecords, streamJsonlRecords } from './fs-read'

/**
 * The History scan shares its process with every chat. A file read resolves its chunks without a
 * macrotask in between, so a fold of a 66 MB transcript held the event loop for 105 ms and a cold
 * scan stalled it for 3.5 s in total. Each of these reads must let the loop turn while it runs —
 * asserted here as "a macrotask scheduled at the start ran before the last record", not as a time.
 */
const dir = tempDirPerTest('ea-yield')
/** Several reads' worth: a stream hands a file over in chunks of at most 512 KB. */
const LINES = 20_000

function bigJsonl(): string {
  const path = join(dir(), 'big.jsonl')
  const line = (i: number) => JSON.stringify({ i, text: 'x'.repeat(200) })
  writeFileSync(path, `${Array.from({ length: LINES }, (_, i) => line(i)).join('\n')}\n`)
  return path
}

/**
 * The index of the first record seen after a macrotask, scheduled when the first record arrived,
 * has run — or -1. Scheduled then rather than up front, because opening the file is I/O and turns
 * the loop anyway; what matters is whether the parsing does.
 */
function turnWatch() {
  let turned = false
  let firstAfter = -1
  let seen = 0
  return {
    record() {
      if (seen === 0) setImmediate(() => (turned = true))
      if (turned && firstAfter < 0) firstAfter = seen
      seen += 1
    },
    get firstAfter() {
      return firstAfter
    },
  }
}

describe('reading a long transcript lets the event loop turn', () => {
  test('a fold yields between reads', async () => {
    const path = bigJsonl()
    const watch = turnWatch()
    await foldJsonlFrom(
      path,
      0,
      Bun.file(path).size,
      () => true,
      () => watch.record(),
    )
    expect(watch.firstAfter).toBeGreaterThan(0)
    expect(watch.firstAfter).toBeLessThan(LINES)
  })

  test('a forward transcript stream yields between reads', async () => {
    const path = bigJsonl()
    const watch = turnWatch()
    for await (const _ of streamJsonlRecords(path, Number.MAX_SAFE_INTEGER)) watch.record()
    expect(watch.firstAfter).toBeGreaterThan(0)
    expect(watch.firstAfter).toBeLessThan(LINES)
  })

  test('a tail read parses its window in slices, not in one turn', async () => {
    const path = bigJsonl()
    const watch = turnWatch()
    for await (const _ of jsonlRecords(path, Number.MAX_SAFE_INTEGER, { fromEnd: true }))
      watch.record()
    expect(watch.firstAfter).toBeGreaterThan(0)
    expect(watch.firstAfter).toBeLessThan(LINES)
  })
})
