import { describe, expect, test } from 'bun:test'

import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  stripComments,
  withPlantedSources,
  type Exemptions,
} from './source-lint'

/**
 * THE KIT'S OWN MUTATION MATRIX.
 *
 * A lint kit that cannot fail is not a guard, it is a decoration — and it would move the
 * comment-blindness problem UP a level rather than fix it. So the mechanisms are not merely
 * tested for their happy path: each is MUTATED into the exact broken shape it was built to
 * outlaw, and the mutant must go RED.
 *
 *   | mutation                          | what must catch it        |
 *   | --------------------------------- | ------------------------- |
 *   | stripComments → () => ''          | assertPositiveControl (1) |
 *   | stripComments → identity          | assertPositiveControl (2) |
 *   | walk stops recursing ('*.ts')     | scanSources minFiles      |
 *   | detector regex neutered           | assertPositiveControl (1) |
 *   | exemption keyed by a bare name    | auditExemptions           |
 *   | a blessing that matches nothing   | auditExemptions (stale)   |
 *
 * The subject under test is a MINIATURE of the real class: "nobody outside the owner may
 * read `process.env` by name" — the shape of `env-contract`, `path-containment-contract`,
 * `claude-config-dir`, and `safe-file-key` alike.
 */

const OFFENDER = `export const port = Number(process.env.LOCALIX_PORT ?? 5051)\n`
const CLEAN = `import { envInt } from './env'\nexport const port = envInt('LOCALIX_PORT') ?? 5051\n`

/** The miniature detector, parameterized on its root and on the kit's two seams. */
function makeDetector(
  opts: { strip?: (s: string) => string; include?: string[]; re?: RegExp } = {},
): (root: string) => Promise<string[]> {
  const re = opts.re ?? /process\.env\.([A-Za-z_$][\w$]*)/g
  return async (root: string) => {
    const files = await scanSources({
      root,
      include: opts.include ?? ['src/**/*.ts'],
      strip: opts.strip,
    })
    const hits: string[] = []
    for (const f of files) {
      for (const m of f.code.matchAll(new RegExp(re.source, 'g')))
        hits.push(exemptionKey(f.file, m[1] as string))
    }
    return hits
  }
}

// ── The nested plant. `src/deep/nested/config.ts` is THREE levels down on purpose: a walk
//    that stopped recursing never opens it, and that must be a failure, not a pass. ──
const PLANT_AT = 'src/deep/nested/config.ts'

describe('stripComments', () => {
  test('removes a trailing comment, not only a whole-line one', () => {
    // The nine hand-rolled copies this replaced dropped only lines that BEGIN with `//`,
    // so this `process.env.X` stayed visible to every scan that used them.
    expect(stripComments('const x = 1 // process.env.SECRET')).not.toContain('process.env')
  })

  test('removes a block comment, and the line count survives it', () => {
    const out = stripComments(['/**', ' * process.env.SECRET', ' */', 'const x = 1'].join('\n'))
    expect(out).not.toContain('process.env')
    expect(out.split('\n')).toHaveLength(4) // a detector may still report a line number
  })

  test('a `//` inside a STRING is not a comment', () => {
    expect(stripComments(`const url = 'https://localix.ai/x'`)).toContain('https://localix.ai/x')
  })

  test('a `//` inside a TEMPLATE is not a comment — and `${…}` is code again', () => {
    const out = stripComments('const u = `https://${host}/a` // trailing\nconst y = 1')
    expect(out).toContain('`https://${host}/a`')
    expect(out).not.toContain('trailing')
  })

  test('a comment INSIDE a `${…}` substitution is still a comment', () => {
    expect(stripComments('const u = `x${/* process.env.SECRET */ a}y`')).not.toContain(
      'process.env',
    )
  })

  test('a `//` inside a REGEX LITERAL is not a comment', () => {
    // `return /…/` is the trap: a stripper that reads `/` as division here never enters the
    // regex, mistakes its `\/\/` for a line comment, and silently truncates the line.
    const out = stripComments(
      `function f() {\n  return /https?:\\/\\//.test(u) && process.env.X\n}`,
    )
    expect(out).toContain('process.env.X')
  })

  test('division is still division (a `/` after a value does not open a regex)', () => {
    expect(stripComments('const r = total / count // ignore')).toContain('total / count')
  })

  test('an apostrophe inside a comment does not run away as a string', () => {
    const out = stripComments(`// don't read process.env here\nconst a = 'ok'`)
    expect(out).toContain(`const a = 'ok'`)
    expect(out).not.toContain('process.env')
  })
})

describe('scanSources', () => {
  test('RECURSES — it opens a file three directories down', async () => {
    const found = await withPlantedSources(
      { [PLANT_AT]: OFFENDER, 'src/top.ts': CLEAN },
      async (root) => (await scanSources({ root, include: ['src/**/*.ts'] })).map((f) => f.file),
    )
    expect(found.sort()).toEqual([PLANT_AT, 'src/top.ts'])
  })

  test('MUTANT — a walk that stops recursing goes RED, it does not report a clean tree', () => {
    // `wire-contract` walked ONE level. The nested offender was never opened, and its empty
    // offender list was indistinguishable from a clean tree. minFiles is what tells them apart.
    expect(
      withPlantedSources({ [PLANT_AT]: OFFENDER }, async (root) =>
        scanSources({ root, include: ['src/*.ts'] }),
      ),
    ).rejects.toThrow(/opened 0 file\(s\)/)
  })

  test('skips what it is told to skip, and dedupes overlapping globs', async () => {
    const files = await withPlantedSources(
      { 'src/a.ts': CLEAN, 'src/a.test.ts': OFFENDER },
      async (root) =>
        scanSources({
          root,
          include: ['src/**/*.ts', 'src/**/*.ts'],
          skip: (f) => f.endsWith('.test.ts'),
        }),
    )
    expect(files.map((f) => f.file)).toEqual(['src/a.ts'])
  })
})

describe('assertNotVoid', () => {
  test('passes when the scan saw its subject', () => {
    expect(() => assertNotVoid('the owner', 1)).not.toThrow()
  })

  test('MUTANT — a scan that reached nothing is RED, not green', () => {
    expect(() => assertNotVoid('the owner', 0)).toThrow(/ANTI-VOID/)
  })
})

describe('assertPositiveControl', () => {
  test('the real detector fires on the planted bug, and stays silent on it as a comment', async () => {
    await assertPositiveControl({
      subject: 'a raw process.env read',
      file: PLANT_AT,
      offender: OFFENDER,
      detect: makeDetector(),
    })
  })

  test('MUTANT — stripComments → () => "" : the detector sees nothing, so the control FAILS', () => {
    // Over-stripping is the quiet mutant: every scan comes back empty, every lint passes,
    // and the tree "looks clean". The control is the only thing between us and that.
    expect(
      assertPositiveControl({
        subject: 'a raw process.env read',
        file: PLANT_AT,
        offender: OFFENDER,
        detect: makeDetector({ strip: () => '' }),
      }),
    ).rejects.toThrow(/POSITIVE CONTROL FAILED/)
  })

  test('MUTANT — stripComments → identity : the commented-out bug LEAKS, and the control FAILS', () => {
    // This is THE class: a lint that scans the file with its comments is satisfied by
    // commented-out code — a plugin order-path guard could be deleted and stay green.
    expect(
      assertPositiveControl({
        subject: 'a raw process.env read',
        file: PLANT_AT,
        offender: OFFENDER,
        detect: makeDetector({ strip: (s) => s }),
      }),
    ).rejects.toThrow(/COMMENT-BLIND/)
  })

  test('MUTANT — the detector regex neutered : the control FAILS', () => {
    expect(
      assertPositiveControl({
        subject: 'a raw process.env read',
        file: PLANT_AT,
        offender: OFFENDER,
        detect: makeDetector({ re: /process\.env\.(ZZZ_NEVER_MATCHES)/ }),
      }),
    ).rejects.toThrow(/POSITIVE CONTROL FAILED/)
  })

  test('MUTANT — the walk stops recursing : the control FAILS (via the walker)', () => {
    expect(
      assertPositiveControl({
        subject: 'a raw process.env read',
        file: PLANT_AT,
        offender: OFFENDER,
        detect: makeDetector({ include: ['src/*.ts'] }),
      }),
    ).rejects.toThrow(/opened 0 file\(s\)/)
  })
})

describe('exemptions', () => {
  const KEY = exemptionKey('src/lib/login-shell-env.ts', '<dynamic>')
  const EXEMPTIONS: Exemptions = { [KEY]: { reason: 'IS the process.env boundary.' } }

  test('a blessed match is not an offender', () => {
    expect(auditExemptions(EXEMPTIONS, [KEY]).offenders).toEqual([])
  })

  test('an unblessed match IS an offender', () => {
    const other = exemptionKey('src/features/x.ts', 'LOCALIX_PORT')
    expect(auditExemptions(EXEMPTIONS, [KEY, other]).offenders).toEqual([other])
  })

  test('the STALE half — a blessing that matches nothing goes red', () => {
    expect(auditExemptions(EXEMPTIONS, []).stale).toEqual([KEY])
  })

  test('`debt` is exempt from the stale half — the fix lands in a tree that cannot edit us', () => {
    const debt: Exemptions = { [KEY]: { reason: 'not ours to fix', debt: true } }
    expect(auditExemptions(debt, []).stale).toEqual([])
  })

  test('MUTANT — an exemption keyed by a BARE NAME is refused', () => {
    // The composition-root bug: keyed by `notify`, a blessed adapter that DROPPED a parameter
    // stayed blessed. The one bug the lint exists to catch, invisible inside its own allowlist.
    expect(() => auditExemptions({ notify: { reason: 'adapter' } }, [])).toThrow(/carry no SHAPE/)
  })

  test('a blessed thing that CHANGES SHAPE loses its blessing — on BOTH halves', () => {
    const blessed = exemptionKey('bootstrap.ts', 'notify(userId, sessionId)')
    const dropped = exemptionKey('bootstrap.ts', 'notify(userId)') // a parameter went missing
    const audit = auditExemptions({ [blessed]: { reason: 'adapter' } }, [dropped])
    expect(audit.offenders).toEqual([dropped]) // the changed binding is no longer blessed
    expect(audit.stale).toEqual([blessed]) // and the blessing no longer names anything
  })

  test('exemptionKey refuses a shapeless key at the source', () => {
    expect(() => exemptionKey('bootstrap.ts')).toThrow(/no SHAPE/)
  })
})
