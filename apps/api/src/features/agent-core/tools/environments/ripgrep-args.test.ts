import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { makeTempDir, removeDir } from '@localixai/testing'
import { join } from 'node:path'

import { interpretRipgrep } from '../environment'
import { buildRipgrepArgs } from './ripgrep'
import { spawnToResult } from './spawn'

/**
 * REGRESSION — `--multiline` must reach ripgrep.
 *
 * `rg` hard-errors (exit 2) on a multi-line regex without it, and models routinely write
 * multi-line regexes. `buildRipgrepArgs` pushes `--multiline` when the pattern contains a
 * newline; since `interpretRipgrep` turns an empty exit-2 into a throw, a missing flag would
 * raise a hard error rather than return matches. These tests are written against that
 * invariant, not against a hard-coded flag list, so they keep holding as flags are added.
 */

const NEWLINE_PATTERNS = [
  ['a real newline in the pattern', 'alpha\nbeta'],
  ['an escaped \\n in the pattern', 'alpha\\nbeta'],
] as const

describe('buildRipgrepArgs — the single source of truth for rg flags', () => {
  test.each(NEWLINE_PATTERNS)('adds --multiline for %s', (_label, pattern) => {
    expect(buildRipgrepArgs(pattern)).toContain('--multiline')
  })

  test('omits --multiline for an ordinary single-line pattern', () => {
    expect(buildRipgrepArgs('alpha')).not.toContain('--multiline')
  })

  test('carries the pattern and search root as the trailing operands', () => {
    const args = buildRipgrepArgs('alpha')
    expect(args.slice(-2)).toStrictEqual(['alpha', '.'])
  })
})

/** BEHAVIOURAL proof, against the real ripgrep binary spawned with the argv we build. */
describe('the argv actually runs (real rg)', () => {
  let dir: string

  beforeAll(async () => {
    dir = makeTempDir('localix-rg-fixture')
    await writeFile(join(dir, 'sample.ts'), 'alpha\nbeta\ngamma\n', 'utf8')
  })
  afterAll(() => {
    removeDir(dir)
  })

  const run = async (pattern: string) =>
    spawnToResult('rg', buildRipgrepArgs(pattern), { cwd: dir })

  test('a MULTI-LINE pattern returns matches instead of hard-erroring (the regression)', async () => {
    const result = await run('alpha\nbeta')
    // Without the flag this is exit 2 with rg's
    // `the literal "\n" is not allowed in a regex` on stderr, which interpretRipgrep
    // (empty stdout + exit>=2) turns into a THROW.
    expect(result.exitCode).toBe(0)
    expect(() => interpretRipgrep(result)).not.toThrow()
    expect(interpretRipgrep(result)).toContain('alpha')
  })

  test('an ordinary pattern still matches, with line numbers and filenames', async () => {
    const out = interpretRipgrep(await run('gamma'))
    expect(out).toContain('sample.ts')
    expect(out).toContain('3:gamma')
  })

  test('a pattern with single quotes reaches rg intact', async () => {
    await writeFile(join(dir, 'quoted.ts'), "it's here\n", 'utf8')
    expect(interpretRipgrep(await run("it's here"))).toContain('quoted.ts')
  })

  test('no matches is an empty string, NOT an error', async () => {
    const result = await run('nothing_matches_this_xyzzy')
    expect(interpretRipgrep(result)).toBe('')
  })
})

describe('a pattern that looks like a flag is still a pattern', () => {
  test('the pattern is passed with -e, so a leading dash cannot be read as a flag', () => {
    // Seen live: searching for `--color-|--token` died with `rg: unrecognized flag`, and the
    // member — told its search was malformed — went to `bash grep`, which is the fallback this
    // tool exists to prevent. CSS custom properties, CLI flags and diff markers all start with
    // a dash, so this is an ordinary thing to look for.
    const args = buildRipgrepArgs('--color-|--token')
    expect(args.indexOf('-e')).toBeGreaterThan(-1)
    expect(args[args.indexOf('-e') + 1]).toBe('--color-|--token')
    // Still the last positional, so rg searches the working directory as before.
    expect(args.at(-1)).toBe('.')
  })
})
