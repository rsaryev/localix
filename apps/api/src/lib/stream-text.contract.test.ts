import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * No chunk of a byte STREAM may be decoded on its own.
 *
 * A `data` handler receives whatever the OS read returned, which lands inside a
 * multi-byte character often enough to matter. `chunk.toString()` there produces
 * U+FFFD on both sides of the split, silently — valid bytes in, wrong text out,
 * nothing raised. It reached the agent through live bash output, an external CLI
 * agent's structured event lines, hook output, ripgrep matches and the PTY screen
 * before this guard existed; five sites, one mistake, none of them loud.
 *
 * `lib/stream-text.ts` is the one correct way (`TextDecoder` with `stream: true`,
 * one decoder per stream). This test exists so a sixth site cannot quietly appear:
 * it scans the source rather than trusting review, because the wrong form looks
 * completely ordinary.
 *
 * Collecting Buffers and decoding ONCE at the end is equally correct and is not
 * flagged — the rule is about decoding a chunk in isolation, not about Buffers.
 */

const API_SRC = path.join(import.meta.dir, '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) out.push(full)
  }
  return out
}

/**
 * A `data`-handler line that turns its chunk straight into text. Deliberately
 * narrow: it looks for the decode INSIDE the handler's own line, which is the shape
 * every real instance took.
 */
const PER_CHUNK_DECODE =
  /\.on\(\s*['"]data['"]\s*,[^\n]*\b(?:toString\(|new TextDecoder\(\)\.decode\()/

describe('streamed bytes are never decoded chunk-by-chunk', () => {
  test('no `data` handler decodes its own chunk', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(API_SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (PER_CHUNK_DECODE.test(line)) {
          offenders.push(`${path.relative(API_SRC, file)}:${i + 1}`)
        }
      })
    }

    expect(
      offenders,
      'decode the STREAM (lib/stream-text.ts), or collect Buffers and decode once at the end',
    ).toEqual([])
  })

  test('the scan is not vacuous — it sees the files and the shape it forbids', () => {
    const files = sourceFiles(API_SRC)
    expect(files.length).toBeGreaterThan(300)
    // The pattern must actually match the form this guard is about, or an empty
    // offender list would mean nothing.
    expect(PER_CHUNK_DECODE.test(`child.stdout?.on('data', (b: Buffer) => cb(b.toString()))`)).toBe(
      true,
    )
    // …and must leave the correct forms alone.
    expect(PER_CHUNK_DECODE.test(`child.stdout?.on('data', (b: Buffer) => cb(decodeOut(b)))`)).toBe(
      false,
    )
    expect(PER_CHUNK_DECODE.test(`child.stdout?.on('data', (b: Buffer) => chunks.push(b))`)).toBe(
      false,
    )
  })
})
