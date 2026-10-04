import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { interpretRipgrep, shellQuote } from '../environment'
import { buildRipgrepArgs, buildRipgrepCommand } from './ripgrep'
import { spawnToResult } from './spawn'

/**
 * REGRESSION — the ssh/docker backends dropped `--multiline`.
 *
 * `remote.ts` hand-rolled its own rg flag string under a comment claiming it "mirrors
 * local searchFiles' flag set". It did not: `local.ts` pushes `--multiline` when the
 * pattern contains a newline, because **ripgrep hard-errors (exit 2) on a multi-line
 * regex without it**. Models routinely write multi-line regexes, so the identical search
 * that succeeded locally FAILED on ssh/docker — and since `interpretRipgrep` turns an
 * empty exit-2 into a throw, the tool raised a hard error rather than returning matches.
 *
 * DORMANT in production today: every session runs on the local backend (the ssh/docker
 * execution backends are built but not wired to any session). This pins the behaviour so
 * it is correct the day they are.
 *
 * The fix is the DEDUPLICATION: one ordered-flag builder feeds both renderings, so the
 * flag set cannot drift again. These tests are written against that invariant — not
 * against a hard-coded flag list — so they keep holding as flags are added.
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

describe('the remote (ssh/docker) rendering cannot diverge from the local argv', () => {
  // THE BUG, stated directly: this assertion failed before the dedup.
  test.each(NEWLINE_PATTERNS)(
    'the remote command carries --multiline for %s',
    (_label, pattern) => {
      expect(buildRipgrepCommand(pattern, '/w')).toContain('--multiline')
    },
  )

  test('every option combination renders the local argv verbatim, only quoted', () => {
    // Structural anti-divergence guard: the remote string IS the local token list,
    // shell-quoted. A flag that reaches one backend therefore reaches the other by
    // construction — a hand-rolled second flag list would break this immediately.
    const cwd = '/work/dir with space'
    for (const pattern of ['alpha', 'alpha\nbeta', "it's a 'quoted' pat"]) {
      for (const opts of [
        undefined,
        { glob: '*.ts' },
        { context: 3 },
        { glob: '*.ts', context: 2 },
      ]) {
        const argv = buildRipgrepArgs(pattern, opts)
        const expected = `cd ${shellQuote(cwd)} && rg ${argv.map(shellQuote).join(' ')}`
        expect(buildRipgrepCommand(pattern, cwd, opts)).toBe(expected)
      }
    }
  })
})

/**
 * BEHAVIOURAL proof, against the real ripgrep binary. The ssh/docker backends run their
 * command string through `bash -c` on the far side; we run the SAME string through
 * `bash -c` locally, which exercises the exact bytes rg would receive remotely.
 */
describe('the remote command actually runs (real rg, via bash -c)', () => {
  let dir: string

  beforeAll(async () => {
    // In-workspace temp dir (not /tmp) so the write needs no approval.
    dir = await mkdtemp(join(import.meta.dir, '.rg-fixture-'))
    await writeFile(join(dir, 'sample.ts'), 'alpha\nbeta\ngamma\n', 'utf8')
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const runRemoteForm = async (pattern: string) => {
    const command = buildRipgrepCommand(pattern, dir)
    return spawnToResult('bash', ['-c', command], {})
  }

  test('a MULTI-LINE pattern returns matches instead of hard-erroring (the regression)', async () => {
    const result = await runRemoteForm('alpha\nbeta')
    // Before the fix this was exit 2 with rg's
    // `the literal "\n" is not allowed in a regex` on stderr, which interpretRipgrep
    // (empty stdout + exit>=2) turns into a THROW.
    expect(result.exitCode).toBe(0)
    expect(() => interpretRipgrep(result)).not.toThrow()
    expect(interpretRipgrep(result)).toContain('alpha')
  })

  test('an ordinary pattern still matches, with line numbers and filenames', async () => {
    const out = interpretRipgrep(await runRemoteForm('gamma'))
    expect(out).toContain('sample.ts')
    expect(out).toContain('3:gamma')
  })

  test('a pattern with single quotes survives the shell rendering', async () => {
    // Guards shellQuote's `'\''` escaping on the path the remote backends take.
    await writeFile(join(dir, 'quoted.ts'), "it's here\n", 'utf8')
    expect(interpretRipgrep(await runRemoteForm("it's here"))).toContain('quoted.ts')
  })

  test('no matches is an empty string, NOT an error', async () => {
    const result = await runRemoteForm('nothing_matches_this_xyzzy')
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

  test('the shell rendering carries the same tokens', () => {
    // The ssh/docker backends render these tokens into `bash -c`; a fix that reached only the
    // local spawn would be the divergence this builder exists to make inexpressible.
    expect(buildRipgrepCommand('--token', '/w')).toContain("'-e' '--token'")
  })
})
