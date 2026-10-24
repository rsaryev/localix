/// <reference types="bun" />

import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import path from 'node:path'

import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  stripComments,
  type Exemptions,
} from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * THE COMPOSITION-ROOT CONTRACT, ENFORCED.
 *
 * **A binding may not restate a signature.**
 *
 * `app.ts` wires services into consumers. When it does that by hand —
 *
 * ```ts
 * codeAction: (userId, sessionId, file, range) => svc.codeAction(userId, sessionId, file, range)
 * ```
 *
 * — the arrow's parameter list is a SECOND COPY of the service's signature, and
 * TypeScript will not keep the two in step. A function is assignable to a
 * signature that declares MORE parameters than it does, so a copy that lost a
 * parameter type-checks perfectly and simply drops the argument at runtime. The
 * copy above is the real one that shipped: five-parameter `codeAction` bound four
 * wide, dropping `kinds`, so an "Organize imports" request over the websocket came
 * back as quick-fixes. Nothing was red. Nothing could be.
 *
 * **Deriving the port's TYPE from the owner does not fix this** — it fixes
 * declaration drift, not binding drift. `Pick<LspDocumentService, 'codeAction'>`
 * still accepts a four-parameter arrow, because the tolerance lives at the
 * assignment, not in the type. (Verified; do not "improve" this lint into a type.)
 *
 * So the rule is structural: the composition root may not SPELL a parameter list
 * it is merely forwarding. Two forms are safe, and both are checked by the compiler:
 *
 *  - **Pass the thing:**   `lsp: deps.lspDocumentService`
 *  - **Spread the call:**  `stop: (...args) => deps.chatService.stop(...args)`
 *
 * The spread form cannot express the bug — there are no named parameters to omit,
 * and `...args` is typed by the consumer's contract, which is derived from the
 * owner. Grow the owner a parameter and the spread goes red ("Expected 6
 * arguments, but got 5"). That is the whole point: the owner stays the ONE
 * authoritative representation of its own signature.
 *
 * An arrow that genuinely RESHAPES its arguments (`saveMedia: (bytes, mediaType)
 * => store.putBase64(Buffer.from(bytes).toString('base64'), mediaType)`) is not a
 * copy of a signature — it is an adapter, and it is allowed. This lint only flags
 * arrows that forward their parameters verbatim, which carry no information at all
 * beyond the arity they might get wrong.
 */

/**
 * ALL composition roots.
 *
 * This lint used to scan `app.ts` alone — and app.ts binds almost nothing: its only
 * restatement was the Hono `origin` callback, then the single ALLOWLIST entry. So
 * `offenders` was permanently `[]` and the lint could NEVER go red.
 *
 * The services are actually wired into their consumers in `bootstrap.ts` (`index.ts` →
 * `bootstrap()`) and its `bootstrap/*.ts` phase modules. Before that file was split, it held
 * 51 restatements — including the LSP `writeFile` port, a sibling of the very `codeAction`
 * binding whose dropped `kinds` parameter shipped the bug described above. The lint was written
 * for a bug that lives here and was pointed at the file where there was nothing to find.
 */
const ROOTS = ['app.ts', 'bootstrap.ts', 'bootstrap/*.ts'] as const

/** Both entry roots and at least one split bootstrap phase must exist in every scanned tree. */
const MIN_ROOT_FILES = 3

/** Where the composition roots live: `apps/api/src`. */
const SRC_ROOT = path.resolve(import.meta.dir, '..', '..')

/**
 * COMMENTS ARE STRIPPED BY `lib/source-lint.ts`, and that is LOAD-BEARING, not cosmetic.
 *
 * The doc comment above spells the offending shape verbatim, as every good lint's docs must
 * — so a comment-blind scan flags its own documentation, and the lint can be silenced by
 * commenting a binding out. Worse, the liveness assertion below (`total > 0`) would then be
 * satisfiable by COMMENTS ALONE: let the regex fall out of step with the real code style and
 * a single JSDoc example keeps the counter non-zero while the scan reaches no code at all.
 *
 * The stripper this file used to carry was line-based, so a TRAILING comment
 * (`x: 1, // notify: (a, b) => svc.notify(a, b)`) still read as a live binding. It now shares
 * the one implementation, which is string-, template- and regex-literal aware.
 */

/**
 * Body of the arrow beginning at `=>` at `from`: scan forward until the brackets
 * opened since the arrow are closed AND we hit a `,` or `}` that ends the property.
 * Good enough for an object-literal member, which is all this lint reads.
 */
function arrowBody(source: string, from: number): string {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return source.slice(from, i)
      depth--
    } else if (ch === ',' && depth === 0) return source.slice(from, i)
  }
  return source.slice(from)
}

/** Index just past the `)` matching the `(` at `open`, or -1. */
function matchParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * Split a parameter list on TOP-LEVEL commas. A parameter's TYPE may itself contain a
 * comma (`opts: Record<string, string>`), so a naive `.split(',')` shreds it.
 */
function splitParams(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of raw) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((p) => p.trim()).filter(Boolean)
}

/**
 * The NAME a parameter forwards under: `userId`, `userId: string`, `userId?: LspRange`.
 *
 * THE TYPE ANNOTATION MUST BE STRIPPED, NOT USED AS A REASON TO SKIP. An earlier draft of
 * this lint required `/^\w+$/` and skipped anything else — which quietly dropped every
 * TYPED parameter list. But the bug this file exists to catch is an ARITY bug, and arity
 * is exactly as droppable when the parameters carry types:
 *
 * ```ts
 * codeAction: (userId: string, sessionId: string, file: string) => svc.codeAction(userId, sessionId, file)
 * ```
 *
 * is the very same silently-four-wide binding, and tsc is just as happy with it. Verified
 * by mutation: with the old `/^\w+$/` filter, injecting that typed line into bootstrap.ts
 * left the lint GREEN. The guard was blind to half the spellings of its own bug.
 *
 * A destructured (`{ a }`), defaulted (`a = 1`), or rest (`...args`) parameter genuinely
 * has no single forwarded name, and returns undefined here.
 */
function paramName(param: string): string | undefined {
  return /^(\w+)\s*\??\s*(?::|$)/.exec(param)?.[1]
}

export interface PassThrough {
  /** The bound property name (`codeAction`). */
  key: string
  /** The parameter names it restated (`userId, sessionId, file, range`), types stripped. */
  params: string[]
  line: number
}

/**
 * Every object-literal binding in `source` that restates a signature: an arrow with
 * named parameters whose body forwards those exact parameters, in order, as the
 * complete argument list of a call. Pure, so it is unit-tested below rather than
 * trusted.
 */
export function findSignatureRestatements(source: string): PassThrough[] {
  const code = stripComments(source)
  const found: PassThrough[] = []
  // `key: (`  /  `key: async (` — the opening of a candidate binding. The parameter list
  // is then read with a balanced-paren scan, because a type may contain `)`
  // (`cb: () => void`), which a `[^)]*` capture would truncate.
  const binding = /(\w+)\s*:\s*(?:async\s+)?\(/g

  for (let m = binding.exec(code); m; m = binding.exec(code)) {
    const key = m[1]
    const open = m.index + m[0].length - 1
    const close = matchParen(code, open)
    if (close < 0) continue

    // `) => ` or `): ReturnType => ` — an explicit return type is still a forward.
    const arrow = /^\s*(?::[^=]+?)?=>/.exec(code.slice(close + 1))
    if (!arrow) continue

    const params = splitParams(code.slice(open + 1, close)).map(paramName)
    if (params.length === 0 || params.some((p) => p === undefined)) continue
    const names = params as string[]

    const body = arrowBody(code, close + 1 + arrow[0].length)
    // Is this parameter list forwarded verbatim as some call's WHOLE argument list?
    const forwarded = new RegExp(String.raw`\(\s*${names.join(String.raw`\s*,\s*`)}\s*\)`)
    if (!forwarded.test(body)) continue

    found.push({
      key,
      params: names,
      line: code.slice(0, m.index).split('\n').length,
    })
  }
  return found
}

/**
 * Bindings that restate a parameter list but are genuine ADAPTERS — each reshapes its
 * arguments (branches on one, projects a field off the result, or injects an argument the
 * port does not carry), so it cannot be written as an opaque `(...args)` spread.
 *
 * Every entry is still a signature the compiler is NOT checking, so keep this list short
 * and prefer moving the reshaping into the owner. A stale entry is itself a bug: the
 * test below fails if a blessing here no longer corresponds to a real binding.
 *
 * THE KEY IS THE WHOLE RESTATED SIGNATURE — `file::key(param, list)` — NOT THE BARE NAME.
 *
 * Keyed by name alone, this allowlist blessed a NAME wherever it appeared, and the names
 * it holds are the most reusable words in the codebase (`notify`, `wake`, `onError`,
 * `resolveCwd`). Two ways that failed, both verified by mutation:
 *
 *  - A brand-new, unrelated `notify: (userId, sessionId, title) => x.notify(userId,
 *    sessionId, title)` dropped into bootstrap.ts was silently blessed — GREEN — even
 *    though nothing had reviewed it. The guard exempted it for reusing a word.
 *  - Worse, a blessed adapter could DROP A PARAMETER and stay blessed, because its name
 *    did not change. The one bug this file exists to catch was invisible inside its own
 *    exception list.
 *
 * Keying on the parameter list closes both: a blessing now names one exact binding, and
 * any edit to its arity breaks the key, so the entry goes stale and the binding goes
 * un-blessed — RED on both halves. Re-review, then update the key.
 */
const EXEMPTIONS: Exemptions = {
  // Bootstrap phase adapters.
  [exemptionKey('bootstrap/app-services.ts', 'resolveModel(userId, modelId, preferred)')]: {
    reason: 'Adapter: projects `{providerConnectionId, modelId}` off the built provider.',
  },
  [exemptionKey('bootstrap/chat-service-deps.ts', 'vaultToolFor(userId)')]: {
    reason:
      'Factory, not a forward: `userId` is captured by four independent closures it builds ' +
      '(list / updateMetadata / remove, each with its own audit actor), so there is no single ' +
      'downstream signature to spread into.',
  },
  [exemptionKey('bootstrap/mods.ts', 'dataDir(plugin)')]: {
    reason:
      'Adapter: looks the mod up in the data folders the last reload recorded and, for one it ' +
      'has not loaded, falls back to `pluginDataDir(plugin, userHome())`, injecting the home ' +
      'directory the port does not carry.',
  },
}

/** The exemption key for a found restatement: the whole signature, qualified by file. */
const blessingKey = (file: string, o: PassThrough): string =>
  exemptionKey(file, `${o.key}(${o.params.join(', ')})`)

/**
 * Every restatement in the composition roots under `root`, as `<file>::<key>(<params>)`.
 *
 * ROOT-PARAMETERIZED — that is the seam the positive controls below use to plant the ORIGINAL
 * BUG (the four-wide `codeAction` binding) on disk and prove the REAL detector fires on it.
 */
async function scanRoots(root: string): Promise<string[]> {
  const files = await scanSources({
    root,
    include: [...ROOTS],
    strip: (s) => s,
    minFiles: MIN_ROOT_FILES,
  })
  // `findSignatureRestatements` strips comments itself (it must: it reports LINE NUMBERS from
  // the stripped text), so the walk hands it the raw source.
  return files.flatMap((f) => findSignatureRestatements(f.raw).map((o) => blessingKey(f.file, o)))
}

describe('composition roots (app.ts + bootstrap modules) may not restate a signature', () => {
  test('no binding forwards its parameters verbatim — pass the method or spread it', async () => {
    const found = await scanRoots(SRC_ROOT)
    const phaseFound = found.filter((key) => key.startsWith('bootstrap/'))

    // ANTI-VOID. Without this, a renamed/moved root — or a regex that stops matching the
    // current code style — makes the scan find NOTHING, and a lint that inspects nothing
    // passes forever. Pin that we are still actually reading these files.
    assertNotVoid(
      'binding in the composition roots',
      found.length,
      `Roots scanned: ${ROOTS.join(', ')}`,
    )
    // `app.ts` alone has one blessed restatement, so the total above can stay non-zero even if
    // the phase glob silently stops reaching the code this guard was written to police.
    assertNotVoid(
      'binding in the split bootstrap phase modules',
      phaseFound.length,
      `Roots scanned: ${ROOTS.join(', ')}`,
    )

    const { offenders } = auditExemptions(EXEMPTIONS, found)
    const report = offenders
      .map((key) => `  ${key}  → use (...args) => …(...args), or bless it here`)
      .join('\n')

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `\n${offenders.length} binding(s) restate a signature the compiler will not check.\n` +
            `A dropped parameter here is INVISIBLE to tsc (a 4-param function is assignable to a\n` +
            `5-param signature) — this is exactly how the lsp.codeAction \`kinds\` bug shipped.\n` +
            `Pass the method itself, or forward opaquely with (...args).\n\n${report}\n`,
    ).toEqual([])
  })

  test('every exemption still names a real binding — a stale blessing goes red', async () => {
    const { stale } = auditExemptions(EXEMPTIONS, await scanRoots(SRC_ROOT))
    expect(
      stale,
      stale.length === 0
        ? ''
        : staleReport(stale) +
            `\nSpecifically: a blessed adapter whose parameter list CHANGED is exactly the event this\n` +
            `guard exists to surface — confirm it did not silently DROP a parameter, then re-key it.\n`,
    ).toEqual([])
  })

  /**
   * POSITIVE CONTROL. Every binding in the real roots is either clean or blessed, so a green
   * run says nothing about whether the detector still works. Plant the REAL BUG — the
   * five-parameter `codeAction` bound four wide, which shipped — and prove it fires; then
   * prove the same line, commented out, does not.
   */
  test('POSITIVE CONTROL — the detector fires on a verbatim forward planted in a root, and never on a commented one', async () => {
    await assertPositiveControl({
      subject: 'a binding that restates a signature',
      file: 'bootstrap/positive-control.ts',
      offender: `export const deps = {\n  codeAction: (userId, sessionId, file, range) => svc.codeAction(userId, sessionId, file, range),\n}\n`,
      // The walk demands both entry roots plus a split phase; the planted offender is that phase.
      scaffold: {
        'app.ts': `export const app = { lsp: deps.lspDocumentService }\n`,
        'bootstrap.ts': `export const bootstrap = () => undefined\n`,
      },
      detect: scanRoots,
    })
  })

  test('POSITIVE CONTROL — a blessed adapter that DROPS a parameter loses its blessing', async () => {
    // The bug the ALLOWLIST itself used to hide. `notify(userId, sessionId)` is blessed; the
    // SAME NAME bound one-wide is a different signature, so it must arrive as an offender.
    const offenders = auditExemptions(EXEMPTIONS, [
      exemptionKey('bootstrap.ts', 'notify(userId)'),
    ]).offenders
    expect(offenders).toEqual([exemptionKey('bootstrap.ts', 'notify(userId)')])
  })
})

describe('findSignatureRestatements (the lint itself)', () => {
  test('flags a verbatim forward — the shape that can silently drop a parameter', () => {
    const src = `const x = { codeAction: (userId, sessionId, file, range) => svc.codeAction(userId, sessionId, file, range) }`
    expect(findSignatureRestatements(src)).toEqual([
      { key: 'codeAction', params: ['userId', 'sessionId', 'file', 'range'], line: 1 },
    ])
  })

  test('flags a verbatim forward even when the result is transformed', () => {
    // Still a copied signature — the parameter list is restated and can drop one.
    const src = `const x = { listDir: (userId, sessionId) => svc.listDirectory(userId, sessionId).then((r) => r.path) }`
    expect(findSignatureRestatements(src).map((o) => o.key)).toEqual(['listDir'])
  })

  test('allows the spread form — it has no parameter list to get wrong', () => {
    const src = `const x = { subscribeAll: (...args) => deps.registry.subscribeAll(...args) }`
    expect(findSignatureRestatements(src)).toEqual([])
  })

  test('allows a bare method reference', () => {
    const src = `const x = { lsp: deps.lspDocumentService }`
    expect(findSignatureRestatements(src)).toEqual([])
  })

  test('allows a genuine adapter that reshapes its arguments', () => {
    const src = `const x = { saveMedia: (bytes, mediaType) => store.putBase64(Buffer.from(bytes).toString('base64'), mediaType) }`
    expect(findSignatureRestatements(src)).toEqual([])
  })

  test('allows an adapter that reorders or drops on purpose (args are not the param list)', () => {
    const src = `const x = { openPreview: (userId, url) => svc.open(url) }`
    expect(findSignatureRestatements(src)).toEqual([])
  })

  // ── The two blind spots found by mutating this lint. Each of these was GREEN before. ──

  test('flags the TYPED spelling of the same forward — arity is just as droppable with types', () => {
    // The old `/^\w+$/` param filter skipped this entirely, so half the spellings of the
    // bug sailed through. Injecting exactly this line into bootstrap.ts left the lint green.
    const src = `const x = { codeAction: (userId: string, sessionId: string, file: string) => svc.codeAction(userId, sessionId, file) }`
    expect(findSignatureRestatements(src).map((o) => o.params)).toEqual([
      ['userId', 'sessionId', 'file'],
    ])
  })

  test('flags a typed forward whose type contains a comma or parens (Record<a, b>, () => void)', () => {
    // A naive `.split(',')` shreds `Record<string, string>`; a `[^)]*` capture truncates at
    // the `)` of `() => void`. Both would silently drop the binding from the scan.
    const src = `const x = { run: (opts: Record<string, string>, cb: () => void) => svc.run(opts, cb) }`
    expect(findSignatureRestatements(src).map((o) => o.params)).toEqual([['opts', 'cb']])
  })

  test('flags a forward that declares an explicit RETURN type', () => {
    const src = `const x = { load: (id: string): Promise<Doc> => svc.load(id) }`
    expect(findSignatureRestatements(src).map((o) => o.key)).toEqual(['load'])
  })

  test('does NOT read a COMMENTED-OUT binding as code — in any of the three spellings', () => {
    // Otherwise the lint is silenced by commenting a binding out — and, far worse, its
    // anti-void counter can be satisfied by prose alone while the scan reaches no real code.
    const src = [
      `// codeAction: (userId, sessionId, file) => svc.codeAction(userId, sessionId, file)`,
      `/* stop: (a, b) => svc.stop(a, b) */`,
      `/**`,
      ` * legacy: (x, y) => svc.legacy(x, y)`,
      ` */`,
      `const x = { lsp: deps.lspDocumentService } // trailing: (a, b) => svc.trailing(a, b)`,
    ].join('\n')
    expect(findSignatureRestatements(src)).toEqual([])
  })

  test('reports the line of the binding even though comments were stripped', () => {
    const src = ['// a comment', '', `const x = { stop: (a, b) => svc.stop(a, b) }`].join('\n')
    expect(findSignatureRestatements(src)[0]?.line).toBe(3)
  })
})
