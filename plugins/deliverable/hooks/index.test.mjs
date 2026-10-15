/**
 * Behavior lock for the deliverable hook's path detection.
 *
 * PATH_RE runs on EVERY assistant message. It used to use two adjacent overlapping
 * quantifiers (`[\w.\-~/ ]*?[\w.\-]+\.ext`) that backtracked QUADRATICALLY on a long
 * unbroken run after a `/` — a real per-message stall, since a reply can echo large
 * external content. These tests pin (1) exactly which paths it detects and (2) that a
 * pathological input stays fast, so the linear rewrite can't silently regress either way.
 */
import { describe, expect, test } from 'bun:test'

import { PATH_RE, proseOnly } from './index.mjs'

/** All non-overlapping matches, fresh lastIndex each call. */
const matches = (s) => s.match(PATH_RE) ?? []

describe('PATH_RE — detects deliverable media paths', () => {
  test.each([
    ['see /tmp/chart.png here', ['/tmp/chart.png']],
    ['saved to ~/report.pdf', ['~/report.pdf']],
    ['two files /a.png and /b.png', ['/a.png', '/b.png']],
    ['space in path /foo bar/baz.csv end', ['/foo bar/baz.csv']],
    ['nested ~/a/b/c/deep.json ok', ['~/a/b/c/deep.json']],
    ['multi-dot /x/file.name.v2.png', ['/x/file.name.v2.png']],
    ['tilde mid-path /home/~user/f.webp', ['/home/~user/f.webp']],
    ['audio ~/voice.m4a and video /clip.mp4', ['~/voice.m4a', '/clip.mp4']],
    ['uppercase ext /PHOTO.PNG', ['/PHOTO.PNG']],
    ['trailing dot /report.pdf.', ['/report.pdf']],
  ])('%s', (input, expected) => expect(matches(input)).toEqual(expected))

  test.each([
    'no extension /just/a/dir/ nothing',
    'unlisted ext /notes.txt and /main.py',
    'relative path chart.png without an anchor',
    'plain prose with no paths at all',
  ])('does not match: %s', (input) => expect(matches(input)).toEqual([]))
})

describe('proseOnly — code is notation, not a deliverable', () => {
  test('strips fenced blocks and inline spans', () => {
    expect(proseOnly('before ```\n/x/a.png\n``` after')).not.toContain('/x/a.png')
    expect(proseOnly('use `/x/b.png` here')).not.toContain('/x/b.png')
    expect(proseOnly('keep /x/c.png in prose')).toContain('/x/c.png')
  })
})

describe('PATH_RE — no catastrophic backtracking', () => {
  test('a long unbroken run after "/" resolves fast (was quadratic)', () => {
    const evil = `/${'a'.repeat(200_000)}.pn` // near-miss ext, never completes
    const t0 = performance.now()
    matches(evil)
    const ms = performance.now() - t0
    // Old form was seconds at this size; linear form is sub-millisecond. Generous ceiling.
    expect(ms).toBeLessThan(250)
  })
})

describe('onAssistantMessage — attaches files in the order named, up to the cap', () => {
  const setup = async (config) => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { register } = await import('./index.mjs')
    const dir = await mkdtemp(join(tmpdir(), 'deliverable-'))
    const problems = []
    const { hooks } = register({
      config,
      helpers: {
        configNumber: (value, fallback) => (value === undefined ? fallback : Number(value)),
        configBoolean: (value, fallback) => value ?? fallback,
      },
      log: () => {},
      reportProblem: (problem) => problems.push(problem),
    })
    const hook = (event) => hooks.onAssistantMessage(event)
    const file = async (name, bytes) => {
      await writeFile(join(dir, name), Buffer.alloc(bytes, 1))
      return join(dir, name)
    }
    return { hook, file, problems, dir }
  }

  test('skips missing and oversize files, keeps order, and judges nothing past the cap', async () => {
    const { hook, file, problems, dir } = await setup({ MAX_FILES: 2, MAX_FILE_MB: 0.001 })
    const big = await file('big.png', 4096)
    const a = await file('a.png', 10)
    const b = await file('b.csv', 20)
    const late = await file('late.png', 4096)
    const result = await hook({
      content: `${dir}/missing.png ${big} ${a} ${b} ${late}`,
      sessionId: 's',
    })
    expect(result.bindings.map((binding) => [binding.name, binding.size])).toEqual([
      ['a.png', 10],
      ['b.csv', 20],
    ])
    // Only the oversize file before the cap is reported; the missing one is silent.
    expect(problems).toHaveLength(1)
    expect(problems[0].detail).toContain('big.png')
    expect(problems[0].detail).not.toContain('late.png')
  })
})
