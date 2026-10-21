import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { jsonlRecords, streamJsonlRecords } from './fs-read'

/**
 * The cap used to stop the stream in silence, and every JSONL adapter counts what it sees and
 * reports that as `total`. So a capped read presented a truncated session as a complete one — and a
 * TAIL read presented its middle as the end. Transcripts past the 32 MB cap occur in a long
 * history, and on one the "tail" ended hours before the session did while reporting a confident
 * `total`.
 */
async function jsonl(lines: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jsonl-'))
  const path = join(dir, 'events.jsonl')
  await writeFile(
    path,
    Array.from({ length: lines }, (_, i) => JSON.stringify({ i })).join('\n'),
    'utf8',
  )
  return path
}

describe('a capped stream says that it stopped short', () => {
  test('the callback fires, and only the records inside the cap are yielded', async () => {
    const path = await jsonl(500)
    let truncated = false
    const seen: number[] = []
    for await (const rec of streamJsonlRecords(path, 64, () => {
      truncated = true
    })) {
      seen.push(rec.i as number)
    }

    expect(truncated).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.length).toBeLessThan(500)
    // The count a caller would report as `total` is a floor, which is the whole point of the signal.
    expect(seen[seen.length - 1]).toBeLessThan(499)
  })

  test('a file inside the cap reads whole and never signals', async () => {
    const path = await jsonl(20)
    let truncated = false
    const seen: number[] = []
    for await (const rec of streamJsonlRecords(path, 1024 * 1024, () => {
      truncated = true
    })) {
      seen.push(rec.i as number)
    }

    expect(truncated).toBe(false)
    expect(seen).toHaveLength(20)
    expect(seen[19]).toBe(19)
  })

  test('no callback is required — the old call shape still works', async () => {
    const path = await jsonl(500)
    const seen: unknown[] = []
    for await (const rec of streamJsonlRecords(path, 64)) seen.push(rec)

    expect(seen.length).toBeGreaterThan(0)
  })
})

describe('a tail read of an oversized file reaches its actual end', () => {
  /**
   * A forward stream cannot: it stops at the cap having read the FRONT. On a transcript well past
   * the cap, the forward "tail" ended hours before the session's last conversational record;
   * reading backwards ends on it exactly. The backward path costs memory the forward one avoids —
   * tens of milliseconds to read and parse the last 32 MB — so it is taken only when the tail is
   * what was asked for.
   */
  test('the last records are the ones yielded, and the cut is still reported', async () => {
    const path = await jsonl(500)
    let truncated = false
    const seen: number[] = []
    for await (const rec of jsonlRecords(path, 64, {
      fromEnd: true,
      onTruncated: () => {
        truncated = true
      },
    })) {
      seen.push(rec.i as number)
    }

    expect(truncated).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    // The END of the file, which the forward read of the same cap can never reach.
    expect(seen[seen.length - 1]).toBe(499)
  })

  test('a window that starts mid-line drops that line rather than parsing half a record', async () => {
    const path = await jsonl(500)
    const seen: number[] = []
    for await (const rec of jsonlRecords(path, 64, { fromEnd: true })) seen.push(rec.i as number)

    // Every yielded record parsed, and they are contiguous to the end.
    expect(seen).toEqual(Array.from({ length: seen.length }, (_, k) => 500 - seen.length + k))
  })

  test('a file inside the cap yields everything from either end, and signals nothing', async () => {
    const path = await jsonl(20)
    let truncated = false
    const fromEnd: number[] = []
    for await (const rec of jsonlRecords(path, 1024 * 1024, {
      fromEnd: true,
      onTruncated: () => {
        truncated = true
      },
    })) {
      fromEnd.push(rec.i as number)
    }

    expect(truncated).toBe(false)
    expect(fromEnd).toEqual(Array.from({ length: 20 }, (_, k) => k))
  })
})
