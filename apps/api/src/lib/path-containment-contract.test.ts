import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  type Exemptions,
} from './source-lint'

/**
 * THE PATH-CONTAINMENT CONTRACT, ENFORCED.
 *
 * "Is this path inside that root?" is a SECURITY question, and it had FOUR answers —
 * `ext/fs-discovery.ts`, `ext/install-tree.ts`, `plugins/marketplace-source.ts`,
 * `plugins/panels.ts`, plus more copies in trees this file's owner could not edit.
 * Every copy re-derived the same two traps (`..` traversal; the sibling-prefix hole a
 * bare `startsWith(root)` leaves open). Four copies of a security check are four
 * chances to get it subtly wrong.
 *
 * WHY A SOURCE-READING GUARD AND NOT A BEHAVIOUR TEST. A behaviour test cannot even
 * OBSERVE this defect: a duplicated check that AGREES with its original passes every
 * assertion, right up until one copy is edited and the other is not. Nothing fails,
 * because nothing disagrees YET. The claim to enforce is therefore STRUCTURAL — "the
 * rule is declared in exactly one place" — so this guard reads the source. Same shape,
 * and same reason, as `env-contract.test.ts` and `resource-refs/providers.test.ts`.
 *
 * WHAT IT LOOKS FOR — the three spellings every hand-rolled copy has used ({@link IDIOMS}):
 *   sep-prefix    `x.startsWith(root + sep)` / `+ '/'` / `+ path.sep`
 *   sep-template  ``x.startsWith(`${root}/`)`` — the same idiom, interpolated
 *   rel-escape    `path.relative(...)` … `rel.startsWith('..')`
 * All three must go through `lib/path-containment.ts` (`isPathWithin` / `isPathBelow` /
 * `resolveWithin`) — or appear below, with a reason.
 *
 * SCOPE: `apps/api/src` ONLY — and now that is a SPLIT, not a ceiling.
 *
 * The owner was PROMOTED to a base-layer package, `@localixai/path-containment`, and
 * `lib/path-containment.ts` re-exports it. That closed the reason this scan could not
 * widen: base packages and `apps/ui` — which cannot import an apps/api module — now
 * import the package, and the hand-rolled copies that used to live in those trees have
 * ADOPTED it. The repo-wide half of the
 * scan moved WITH the owner, into `packages/path-containment/src/monopoly.test.ts` (on
 * the `@localixai/source-lint` kit, which `packages/**` can reach). This file stays the
 * apps/api-side guard over apps/api's own ~30 in-tree adopters — the same dependency-order
 * split the source-lint package documents, one guard per side of the base-package ← api
 * boundary. Between the two, every first-party tree is covered.
 *
 * MECHANICS come from `lib/source-lint.ts` (stripper / recursing walk / anti-void /
 * two-halved exemptions / on-disk positive control).
 */

/** The owner. The one file allowed to spell the rule. */
const OWNER = 'src/lib/path-containment.ts'

/**
 * The idioms, each named — because the NAME is half the exemption key.
 *
 * Keyed by file ALONE, a blessing said "this file's `startsWith` is a string-shape sniff,
 * not containment" — and then went on blessing the file after it grew a REAL containment
 * check of a different shape. Keyed `<file>::<idiom>`, a new idiom is a new key, so it
 * arrives UNBLESSED (red) and the reviewer is asked the question again.
 */
const IDIOMS = {
  /** `x.startsWith(<expr> + sep)` / `+ path.sep` / `+ '/'`. */
  'sep-prefix': /\.startsWith\([^;\n]*?\+\s*(?:(?:path\.)?sep\b|['"`]\/['"`])/,
  /** The same idiom spelled as a TEMPLATE: ``startsWith(`${root}/`)`` / ``` `${root}${sep}` ```.
   *  Without this, a copy evades the guard by swapping `+` for interpolation — which is
   *  exactly how `context-fabric/policy.ts` slipped past the first draft of this file. */
  'sep-template': /\.startsWith\(\s*`[^`]*\$\{[^}]*\}(?:\/|\$\{\s*(?:path\.)?sep\s*\})/,
  /** `…startsWith('..')` / `startsWith('../')` — the relative-escape idiom. */
  'rel-escape': /\.startsWith\(\s*['"`]\.\./,
} as const

const EXEMPTIONS: Exemptions = {
  // ── Not path containment at all: string-shape sniffs and non-path prefixes ──
  [exemptionKey('src/features/plugins/marketplace-source.ts', 'rel-escape')]: {
    reason:
      'SNIFFS whether a marketplace `source` string LOOKS like a local path (`startsWith("./")`, `"../"`, `"/"`, `"~"`) before it is ever resolved. That is a syntax classification, not a containment check — the containment check in this same file DOES go through the owner.',
  },
  [exemptionKey('src/features/agent-core/tools/preview/open-preview-detect.ts', 'rel-escape')]: {
    reason:
      'Sniffs whether an argument string looks like a file path vs a URL. No root, nothing to contain.',
  },
  [exemptionKey('src/features/chat/runtime/model-resolution.ts', 'sep-template')]: {
    reason:
      'Owns the MODEL-ID namespace check (`hasProviderPrefix`: `anthropic/…`). It compares catalog identifiers; it never resolves or accesses a filesystem path. Other model code calls it instead of repeating the idiom.',
  },
  [exemptionKey('src/features/capabilities/cleanup.ts', 'sep-template')]: {
    reason:
      'Matches an MCP server’s per-tool rule actions (`mcp:<server>/<tool>`) when the server is removed. It compares rule identifiers only; no filesystem path is resolved or accessed.',
  },
  [exemptionKey('src/features/usage/ledger-rows.ts', 'sep-template')]: {
    reason:
      'Normalizes a persisted MODEL ID by removing its provider namespace (`openai/…`) before rebuilding a missing usage-ledger row. It compares catalog identifiers only; no filesystem path is resolved or accessed.',
  },
  [exemptionKey('src/features/context-fabric/policy.ts', 'sep-template')]: {
    reason:
      'Matches an already-RELATIVE path against a user-supplied EXCLUSION PREFIX (`src/secrets`), which is a glob-ish pattern, not a filesystem root — resolving it against a root would change what an empty/odd prefix means. The real root-containment check in this file DOES go through the owner.',
  },
  [exemptionKey('src/features/plugins/backend-host.ts', 'sep-template')]: {
    reason:
      'Matches an incoming HTTP REQUEST PATH (`c.req.path`) against a plugin backend MOUNT PREFIX to route it to the right sub-app. A URL route, not a filesystem path — there is no root, and nothing on disk to contain.',
  },
  [exemptionKey('src/features/agent-core/tools/workspace.ts', 'sep-prefix')]: {
    reason:
      'Its root-containment check ADOPTED the owner (`isPathWithin`). What remains is a SAFE_SYSTEM_PREFIXES scan: an allow-list of system dirs a token may name (`/usr`, `/etc`, …) with no root to be contained in. Blessed for `sep-prefix` ONLY — a new idiom in this file would arrive unblessed.',
  },

  // NOTE. Four `debt` entries used to live here (agent-core preview-static + lsp-nav,
  // chat fs-mutations, lsp diagnostics-report). Every one has since ADOPTED the owner, and
  // the scan can no longer see them — the temporary seam came due and is discharged. Do not
  // re-add a debt entry by reflex: it is a promise that adoption is possible.
}

const API_ROOT = path.resolve(import.meta.dir, '..', '..')

/** Every `<file>::<idiom>` hand-rolled containment check under `root`. ROOT-PARAMETERIZED so
 *  the positive control below exercises this exact function, not a restatement of it. */
async function scanContainmentIdioms(root: string): Promise<string[]> {
  const files = await scanSources({
    root,
    include: ['src/**/*.ts'],
    skip: (f) => f === OWNER || f.endsWith('.test.ts'),
  })
  const hits: string[] = []
  for (const f of files) {
    for (const [idiom, re] of Object.entries(IDIOMS)) {
      if (re.test(f.code)) hits.push(exemptionKey(f.file, idiom))
    }
  }
  return hits
}

describe('path-containment contract', () => {
  test('every path-containment check outside lib/path-containment.ts is exempt', async () => {
    const found = await scanContainmentIdioms(API_ROOT)

    // ANTI-VOID. Every entry below is a real match that must stay visible. Zero hits does not
    // mean a clean tree — it means the walk or the idiom regexes stopped reaching the code.
    assertNotVoid(
      '`startsWith`-style containment idiom',
      found.length,
      'Did the walk, or IDIOMS, stop matching?',
    )

    const { offenders } = auditExemptions(EXEMPTIONS, found)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Route it through lib/path-containment.ts (isPathWithin / isPathBelow / resolveWithin) — or, if it is genuinely not a containment check, add it to EXEMPTIONS in this file WITH A REASON:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('the exemption list has no stale entries (every blessing is still real)', async () => {
    const { stale } = auditExemptions(EXEMPTIONS, await scanContainmentIdioms(API_ROOT))
    expect(stale, stale.length === 0 ? '' : staleReport(stale)).toEqual([])
  })

  /**
   * POSITIVE CONTROL. The goal state is "no NEW copy", so a green run is indistinguishable
   * from a broken detector unless the detector is shown to bite. Plant the original bug —
   * the sibling-prefix hole, hand-rolled — and prove it does; then prove the same lines,
   * commented out, do NOT (the class of defect this whole kit exists to close).
   */
  test('POSITIVE CONTROL — the detector fires on a hand-rolled containment check, and never on a commented one', async () => {
    await assertPositiveControl({
      subject: 'a hand-rolled path-containment check',
      file: 'src/features/some-feature/store.ts',
      offender: [
        `import path from 'node:path'`,
        `export function inside(root: string, p: string): boolean {`,
        `  const abs = path.resolve(p)`,
        `  return abs === root || abs.startsWith(root + path.sep)`,
        `}`,
      ].join('\n'),
      detect: scanContainmentIdioms,
    })
  })

  test('POSITIVE CONTROL — the interpolated spelling is caught too (it once was not)', async () => {
    await assertPositiveControl({
      subject: 'an interpolated containment check',
      file: 'src/features/some-feature/policy.ts',
      offender:
        'export const inside = (root: string, p: string): boolean => p.startsWith(`${root}/`)\n',
      detect: scanContainmentIdioms,
    })
  })

  test('POSITIVE CONTROL — the relative-escape spelling is caught too', async () => {
    await assertPositiveControl({
      subject: 'a relative-escape containment check',
      file: 'src/features/some-feature/serve.ts',
      offender: [
        `import path from 'node:path'`,
        `export const inside = (root: string, p: string): boolean =>`,
        `  !path.relative(root, p).startsWith('..')`,
      ].join('\n'),
      detect: scanContainmentIdioms,
    })
  })
})
