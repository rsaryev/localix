/**
 * THE SOURCE-READING LINT KIT — the one owner of "how do we read our own source".
 *
 * A dozen guards in `apps/api` enforce a STRUCTURAL claim ("the rule is declared in
 * exactly one place", "the composition root may not restate a signature", "a declared
 * field is consumed") by READING THE SOURCE, because no behaviour test can observe those
 * defects: duplicated code that AGREES passes every assertion, and an absence is invisible.
 *
 * Every one of them hand-rolled the same four mechanisms — and each got a different subset
 * of them wrong. The failures were not exotic; they were the same four, over and over:
 *
 *  1. COMMENT-BLINDNESS. A lint that scans the file WITH ITS COMMENTS is satisfied by
 *     commented-out code. An extension lint matched its own token inside a
 *     commented-out line, so the guard it protects could be deleted and stay green. Nine
 *     copies of `stripComments` existed in this repo; the common one dropped only lines
 *     that BEGIN with `//`, `/*` or `*`, so a trailing `foo() // process.env.X` still read
 *     as code — and none of them knew that `'//'` inside a string is not a comment.
 *  2. A WALK THAT DOES NOT RECURSE. `wire-contract` walked one directory level, so a
 *     nested file was never opened — AND AN EMPTY OFFENDER LIST LOOKS EXACTLY LIKE A CLEAN
 *     TREE. The lint was, in effect, off.
 *  3. NO ANTI-VOID ASSERTION. Rename the subject, move the file, let a regex fall out of
 *     step with the code style, and the scan reaches nothing. A guard that inspects
 *     nothing passes forever — moving code SILENTLY DISABLES the lint instead of failing it.
 *  4. AN EXEMPTION KEYED BY A BARE NAME. An allowlist keyed by a name blesses that NAME
 *     wherever it appears — including a blessed symbol that has since CHANGED SHAPE. The
 *     composition-root lint blessed `notify` by name, so a blessed adapter that DROPPED A
 *     PARAMETER stayed blessed: the one bug the file exists to catch was invisible inside
 *     its own exception list.
 *
 * So the mechanisms live here, once, and are themselves falsifiable — `source-lint.test.ts`
 * mutates each one (strip → `''`, strip → identity, break the recursion, neuter the
 * detector regex) and asserts each mutant goes RED. A kit whose own tests cannot fail just
 * moves the problem up a level.
 *
 * WHY `apps/api/src/lib` AND NOT ONE REPO-WIDE OWNER. Base packages sit upstream of
 * `apps/api` in the dependency order and cannot import it — that is the
 * architecture, not an oversight. There are therefore exactly TWO owners of this kit, one
 * per side of that boundary; this is the `apps/api` one. (Clean Architecture: dependencies
 * point inward; a shared owner that inverted them would be worse than two.)
 *
 * NOTE it is production-tree code with test-only callers, and deliberately so: it must be
 * importable by a lint anywhere under `apps/api/src` (and by the bundled `plugins/*`
 * backends, which import apps/api by relative path). It pulls in nothing but `bun` + `node`
 * builtins, and imports `bun:test` NOWHERE — it signals failure by THROWING, so a caller in
 * any harness (or none) gets the same diagnosis.
 */

import { Glob } from 'bun'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// 1. stripComments — ONE implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keywords after which a `/` begins a REGEX LITERAL, not a division.
 *
 * Without them, `return /foo/.test(x)` reads as division, the scanner never enters the
 * regex, and a `//` inside it (`/https?:\/\//`) is mistaken for a line comment — which
 * would silently truncate the rest of that line from every scan.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'case',
  'yield',
  'await',
  'throw',
])

/** May a `/` at the end of `emitted` start a regex literal (vs. be a division)? */
function regexMayStart(emitted: string): boolean {
  let i = emitted.length - 1
  while (i >= 0 && /\s/.test(emitted[i] as string)) i--
  if (i < 0) return true // start of file

  const ch = emitted[i] as string
  // A value just ended: `)` `]` `'x'` `"x"` `` `x` `` `1` `ident` → the `/` divides it.
  if (ch === ')' || ch === ']' || ch === "'" || ch === '"' || ch === '`') return false
  if (/[\w$]/.test(ch)) {
    let j = i
    while (j >= 0 && /[\w$]/.test(emitted[j] as string)) j--
    const word = emitted.slice(j + 1, i + 1)
    if (/^\d/.test(word)) return false // numeric literal → division
    return REGEX_PRECEDING_KEYWORDS.has(word)
  }
  // `(` `,` `=` `:` `[` `{` `;` `!` `&` `|` `?` `+` `-` `*` `%` `~` `^` `<` `>` `}` …
  return true
}

/** Index just past the closing `quote`. An unterminated literal stops at the newline. */
function scanQuoted(src: string, start: number, quote: string): number {
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i] as string
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === quote) return i + 1
    if (ch === '\n') return i // unterminated — do not swallow the rest of the file
  }
  return src.length
}

/**
 * Index just past a regex literal's closing `/` + flags, or `-1` when this `/` cannot be
 * one (a regex literal may not span a line). Char classes are tracked, because `/[/]/` is
 * legal and its inner `/` does not close the literal.
 */
function scanRegexLiteral(src: string, start: number): number {
  let inClass = false
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i] as string
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '\n') return -1
    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === '/') {
      let j = i + 1
      while (j < src.length && /[a-z]/i.test(src[j] as string)) j++
      return j
    }
  }
  return -1
}

/**
 * Remove `//` line comments and `/* … *\/` block comments from TypeScript source — and
 * NOTHING ELSE.
 *
 * Three properties every caller depends on, and which the nine hand-rolled copies this
 * replaced did not all have:
 *
 *  - A `//` inside a STRING (`'https://x'`), a TEMPLATE (`` `${a}//${b}` ``), or a REGEX
 *    (`/https?:\/\//`) is not a comment. A stripper that eats it truncates real code out of
 *    the scan — the same silent blindness, arriving from the other direction.
 *  - A TRAILING comment is a comment: `const x = 1 // process.env.FOO` must not leave
 *    `process.env.FOO` visible. The common line-based copy kept it.
 *  - LINE NUMBERS SURVIVE. Newlines inside a block comment are re-emitted, so a detector
 *    can still report the line it matched (`composition-root-contract` does).
 */
export function stripComments(src: string): string {
  let out = ''
  // Context stack. `code` is ordinary source — INCLUDING the inside of a `${…}`
  // substitution, where comments are legal again. `template` is a template literal's text,
  // where they are not. `braces` counts `{}` inside a `code` context so the `}` that CLOSES
  // a substitution is told apart from an ordinary block's.
  const stack: { kind: 'code' | 'template'; braces: number }[] = [{ kind: 'code', braces: 0 }]

  let i = 0
  const n = src.length
  while (i < n) {
    const ctx = stack[stack.length - 1] as { kind: 'code' | 'template'; braces: number }
    const ch = src[i] as string

    if (ctx.kind === 'template') {
      if (ch === '\\') {
        out += src.slice(i, i + 2)
        i += 2
      } else if (ch === '`') {
        stack.pop()
        out += ch
        i++
      } else if (ch === '$' && src[i + 1] === '{') {
        stack.push({ kind: 'code', braces: 0 })
        out += '${'
        i += 2
      } else {
        out += ch
        i++
      }
      continue
    }

    // ── code ──
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++ // the newline itself is left to be emitted
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n' // keep the line count intact
        i++
      }
      i += 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(src, i, ch)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      stack.push({ kind: 'template', braces: 0 })
      out += ch
      i++
      continue
    }
    if (ch === '/' && regexMayStart(out)) {
      const end = scanRegexLiteral(src, i)
      if (end > 0) {
        out += src.slice(i, end)
        i = end
        continue
      }
      // Not a regex after all — fall through and emit the `/` as an ordinary character.
    }
    if (ch === '{') {
      ctx.braces++
    } else if (ch === '}') {
      if (ctx.braces === 0 && stack.length > 1) {
        stack.pop() // this `}` closes a `${…}` substitution
        out += ch
        i++
        continue
      }
      ctx.braces--
    }
    out += ch
    i++
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The walker — it RECURSES, and it proves it opened something
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceFile {
  /** Path relative to the scan root, always `/`-separated (a stable allowlist key). */
  file: string
  /** Absolute path on disk. */
  abs: string
  /** The bytes as text. */
  raw: string
  /** `raw` with comments removed — WHAT A DETECTOR MUST READ. */
  code: string
}

export interface ScanOptions {
  /** Directory the globs are relative to. A SEAM: a positive control points it at a
   *  planted temp tree, so the SAME detector runs against the shape of the real bug. */
  root: string
  /** Bun globs. Use `**` — a one-level walk is defect #2 in the header. */
  include: string[]
  /** Files to leave out (usually `.test.ts` and the rule's OWNER). */
  skip?: (file: string) => boolean
  /** The comment stripper. Injectable ONLY so `source-lint.test.ts` can mutate it and
   *  prove the guards go red; production callers must leave it alone. */
  strip?: (src: string) => string
  /** The walk THROWS below this many files. Defect #3: a walk that opens nothing looks
   *  exactly like a clean tree, so "I opened files" is itself an assertion. */
  minFiles?: number
}

/** Every source file under `root` matching `include`, comment-stripped. Throws if the walk
 *  opened fewer than `minFiles` — a scan that reached nothing is a DISABLED lint, not a
 *  passing one. */
export async function scanSources(opts: ScanOptions): Promise<SourceFile[]> {
  const strip = opts.strip ?? stripComments
  const minFiles = opts.minFiles ?? 1
  const seen = new Set<string>()
  const files: SourceFile[] = []

  for (const pattern of opts.include) {
    for await (const rel of new Glob(pattern).scan(opts.root)) {
      const file = rel.split(path.sep).join('/')
      if (file.includes('node_modules/') || file.includes('/dist/')) continue
      if (opts.skip?.(file)) continue
      if (seen.has(file)) continue
      seen.add(file)
      const abs = path.join(opts.root, rel)
      const raw = await Bun.file(abs).text()
      files.push({ file, abs, raw, code: strip(raw) })
    }
  }

  if (files.length < minFiles) {
    throw new Error(
      [
        `source-lint: the walk opened ${files.length} file(s), expected at least ${minFiles}.`,
        `  root:    ${opts.root}`,
        `  include: ${opts.include.join(', ')}`,
        '',
        'A scan that reaches nothing is a DISABLED lint, not a passing one — an empty offender',
        'list looks exactly like a clean tree. Did the tree move, or does the glob fail to recurse?',
      ].join('\n'),
    )
  }
  return files
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Anti-void — the scan must prove it found its subject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scan must SEE the thing it polices. Call it with the count of real matches the
 * detector produced against the PRODUCTION root (the owner, the known bindings, the
 * interface's fields).
 *
 * Without this, moving the subject silently disables the lint: every other assertion in the
 * file then passes vacuously. With it, moving the subject turns the lint RED, and the
 * message says where to re-point it.
 */
export function assertNotVoid(subject: string, matches: number, hint = ''): void {
  if (matches > 0) return
  throw new Error(
    [
      `ANTI-VOID: this lint scanned the tree and found no ${subject}.`,
      '',
      'That is not a clean tree — it is a lint that is now inspecting NOTHING, and would pass',
      'forever. Something it reads was renamed, moved, or reshaped past its detector.',
      hint && `\n${hint}`,
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Exemptions — with a stale half, and keyed by SHAPE
// ─────────────────────────────────────────────────────────────────────────────

/** Separates the parts of an exemption key. */
export const KEY_SEP = '::'

export interface Exemption {
  /** WHY this match is not the defect. Mandatory: an unexplained blessing is a bug in wait. */
  reason: string
  /**
   * A recorded VIOLATION, not a blessing: it should be fixed, but the file lives in a tree
   * this lint's owner may not edit. It is EXPECTED to disappear, so the stale half skips it
   * — failing when someone else lands the fix would turn a GOOD change red, and a guard that
   * punishes the fix is a guard people learn to switch off.
   */
  debt?: true
}

export type Exemptions = Record<string, Exemption>

/**
 * Compose an exemption key. An exemption MUST name more than a bare identifier — it must
 * carry the SHAPE of what is blessed (the parameter list, the matched idiom, the claim, the
 * literal), so that a blessed symbol which CHANGES SHAPE loses its blessing.
 *
 * That is defect #4 in the header, and it is not hypothetical: keyed by the bare name
 * `notify`, the composition-root allowlist blessed a blessed adapter EVEN AFTER IT DROPPED
 * A PARAMETER — the exact bug the lint exists to catch, invisible inside its own exception
 * list. Keyed by `bootstrap.ts::notify(userId, sessionId)`, the same edit breaks the key:
 * the binding goes un-blessed (RED) and the entry goes stale (RED). Re-review, then re-key.
 */
export function exemptionKey(subject: string, ...shape: string[]): string {
  if (shape.every((s) => s.trim() === '')) {
    throw new Error(
      `source-lint: exemptionKey('${subject}') was given no SHAPE. A bare name blesses a NAME, ` +
        'not a thing — and a blessed thing that changes shape must LOSE its blessing.',
    )
  }
  return [subject, ...shape].join(KEY_SEP)
}

export interface ExemptionAudit {
  /** Matches nothing blessed: the lint's real finding. */
  offenders: string[]
  /** Blessings that match nothing any more (excluding `debt`): the other half. */
  stale: string[]
}

/**
 * Both halves of an allowlist, in one place.
 *
 * The OFFENDER half is why the lint exists. The STALE half is what keeps the allowlist
 * honest: a blessing that stopped being true must be DELETED, not left to bless the next
 * thing that happens to reuse its key.
 *
 * Refuses a key with no `::` — see {@link exemptionKey}. A bare-name allowlist is the
 * failure mode this primitive exists to make impossible, so it is rejected loudly rather
 * than quietly tolerated.
 */
export function auditExemptions(exemptions: Exemptions, found: Iterable<string>): ExemptionAudit {
  const bare = Object.keys(exemptions).filter((k) => !k.includes(KEY_SEP))
  if (bare.length > 0) {
    throw new Error(
      [
        `source-lint: ${bare.length} exemption key(s) carry no SHAPE (no '${KEY_SEP}'):`,
        ...bare.map((k) => `  ${k}`),
        '',
        'An exemption keyed by a bare name blesses that NAME wherever it appears — including a',
        'blessed symbol that has since CHANGED SHAPE. Build keys with exemptionKey(subject, …shape).',
      ].join('\n'),
    )
  }

  const hits = new Set(found)
  const offenders = [...hits].filter((k) => !(k in exemptions)).sort()
  const stale = Object.entries(exemptions)
    .flatMap(([key, e]) => (!e.debt && !hits.has(key) ? [key] : []))
    .sort()
  return { offenders, stale }
}

/** The standard failure message for a stale blessing. */
export function staleReport(stale: string[]): string {
  return [
    '',
    `${stale.length} exemption(s) no longer match anything the scan can see:`,
    ...stale.map((k) => `  ${k}`),
    '',
    'A blessing names ONE thing, by its shape. If the shape changed, that is exactly the event',
    'this guard exists to surface: re-read it, confirm it did not silently become the defect,',
    'then update the key. A blessing that stopped being true must be deleted.',
    '',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Positive control — plant the bug, prove the REAL detector bites
// ─────────────────────────────────────────────────────────────────────────────

/** Write `files` into a fresh temp tree, run `fn` against it, always clean up. */
export async function withPlantedSources<T>(
  files: Record<string, string>,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'source-lint-'))
  try {
    for (const [rel, source] of Object.entries(files)) {
      const abs = path.join(root, rel)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, source, 'utf8')
    }
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export interface PositiveControl {
  /** What is being proved catchable, for the failure message ("a hand-rolled containment check"). */
  subject: string
  /** Where to plant it, relative to the planted root. MUST match the detector's include globs
   *  — and should be NESTED, so a walk that stopped recursing is caught here too. */
  file: string
  /** The ORIGINAL BUG's shape, as source. */
  offender: string
  /** The REAL detector, parameterized on its root. Returns the keys it flagged. */
  detect: (root: string) => Promise<string[]> | string[]
  /** Anything else the detector needs on disk (an owner file, a second consumer). */
  scaffold?: Record<string, string>
}

const lineCommented = (src: string): string =>
  src
    .split('\n')
    .map((l) => `// ${l}`)
    .join('\n')

const blockCommented = (src: string): string => `/*\n${src.replaceAll('*/', '* /')}\n*/`

/**
 * THE POSITIVE CONTROL. Reading a lint is not verifying it.
 *
 * Plants the original bug's shape ON DISK, in a tree the walker really walks, and asserts:
 *
 *  1. the REAL detector FIRES on it — so a green run means "no offender", never "the
 *     detector quietly stopped working"; and
 *  2. the SAME shape, COMMENTED OUT, stays SILENT — both as `//` lines and inside a block —
 *     so the guard cannot be satisfied (or defeated) by prose.
 *
 * Throws with a diagnosis on either failure.
 */
export async function assertPositiveControl(c: PositiveControl): Promise<void> {
  const run = async (source: string): Promise<string[]> =>
    withPlantedSources({ ...c.scaffold, [c.file]: source }, async (root) => [
      ...(await c.detect(root)),
    ])

  const fired = await run(c.offender)
  if (fired.length === 0) {
    throw new Error(
      [
        `POSITIVE CONTROL FAILED: the detector did NOT fire on ${c.subject}.`,
        '',
        `Planted at ${c.file}:`,
        c.offender
          .split('\n')
          .map((l) => `  | ${l}`)
          .join('\n'),
        '',
        'The lint is now VOID: it reports an empty offender list whatever the tree contains,',
        'which is indistinguishable from a clean tree. Repair the detector — do not delete this.',
      ].join('\n'),
    )
  }

  const maskedRuns = await Promise.all(
    [
      ['line-commented (`// …`)', lineCommented(c.offender)],
      ['inside a block comment (`/* … */`)', blockCommented(c.offender)],
    ].map(async ([how, masked]) => ({ how, leaked: await run(masked) })),
  )
  for (const { how, leaked } of maskedRuns) {
    if (leaked.length > 0) {
      throw new Error(
        [
          `COMMENT-BLIND: the detector fired on ${c.subject} that was ${how}.`,
          '',
          `  flagged: ${leaked.join(', ')}`,
          '',
          'It is reading the file WITH ITS COMMENTS. Two consequences, both bad: the guard cries',
          'wolf on its own documentation, and — the reason this class exists — a rule can be',
          'satisfied by prose while the real code that must exist is commented out.',
          '',
          'Read `code` (comment-stripped), never `raw`.',
        ].join('\n'),
      )
    }
  }
}
