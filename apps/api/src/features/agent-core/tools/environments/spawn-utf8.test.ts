import { describe, expect, test } from 'bun:test'

import { spawnToResult } from './spawn'

/**
 * Command output arrives in OS-sized reads that land wherever the buffer ended —
 * regularly inside a multi-byte character. Decoding each read on its own turns that
 * character into U+FFFD, which is how a ripgrep match on non-ASCII text, or a path
 * with an accent, came back subtly wrong with nothing reporting it.
 */
describe('spawnToResult UTF-8 across read boundaries', () => {
  test('a large non-ASCII stream round-trips with no replacement characters', async () => {
    // Big enough to cross many pipe reads, and built from 2-, 3- and 4-byte
    // characters so a boundary lands mid-character many times over.
    const unit = '┌─┐ café naïve 🎉 '
    const repeats = 20_000
    const expected = unit.repeat(repeats)

    const res = await spawnToResult(
      '/bin/bash',
      ['-c', `printf '%s' "$UNIT" | awk -v n=${repeats} '{for(i=0;i<n;i++) printf "%s", $0}'`],
      { env: { ...process.env, UNIT: unit }, uncapped: true },
    )

    expect(res.exitCode).toBe(0)
    expect(res.stdout).not.toContain('�')
    expect(res.stdout.length).toBe(expected.length)
    expect(res.stdout).toBe(expected)
  })

  test('stderr decodes independently of stdout', async () => {
    const res = await spawnToResult('/bin/bash', ['-c', 'printf "┌out┐"; printf "┌err┐" >&2'], {})

    expect(res.stdout).toBe('┌out┐')
    expect(res.stderr).toBe('┌err┐')
    expect(res.stdout + res.stderr).not.toContain('�')
  })
})
