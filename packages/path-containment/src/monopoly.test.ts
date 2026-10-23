import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { type OffenderShape, auditDetector, offendersIn, sourceTree } from '@localixai/source-lint'

/**
 * THE MONOPOLY, ENFORCED REPO-WIDE.
 *
 * "Is this path inside that root?" is a SECURITY question, and this repo answered it in SIX
 * places at once — `apps/api` (which had its own source-reading guard), plus five copies in
 * package and UI trees that guard could not reach.
 * That guard was scoped to `apps/api` ON PURPOSE and said so: the rule lived in an apps/api
 * module, `@localixai/api` exported no subpath for it, and `packages/*` may not depend on
 * `apps/api` anyway — so those five trees were PHYSICALLY UNABLE to import the rule and each
 * re-derived it. A guard that fails a change nobody can make is a guard people switch off;
 * the apps/api one correctly refused to widen and reported the real fix as a promotion.
 *
 * The owner is now a base-layer PACKAGE every tree can import (`@localixai/path-containment`),
 * so the scan can finally follow it. This is that widened scan: it reads EVERY first-party
 * source tree and asserts the three hand-rolled ancestry idioms appear only in the owner or
 * in the exemption list below — the promotion's other half, the one that keeps a SIXTH copy
 * from ever appearing where the old guard's blind spot was.
 *
 * ── WHY A SOURCE-READING GUARD AND NOT A BEHAVIOUR TEST ─────────────────────────────────
 * A behaviour test cannot even OBSERVE this defect: a duplicated check that AGREES with its
 * original passes every assertion, right up until one copy is edited and the other is not.
 * Historical copies silently disagreed at the filesystem root. The claim to enforce is
 * therefore STRUCTURAL — "the rule is declared in exactly one place" — so this guard reads
 * the source.
 *
 * ── THE BRAND DOES THE HARD PART; THIS SCAN CLOSES THE SEAM ─────────────────────────────
 * The `ContainedPath` brand already makes a copy POINTLESS where a callee demands proof: a
 * hand-rolled check returns a bare `string` and will not typecheck. This scan covers the
 * rest — a `boolean` ancestry decision (`isAtOrUnder`), where there is no path VALUE to
 * brand, only a yes/no. There, "route it through the owner" is still the rule, and this is
 * what enforces it.
 *
 * ── MECHANICS ──────────────────────────────────────────────────────────────────────────
 * `@localixai/source-lint` supplies the comment-stripping reader, the recursing walk, and
 * the on-disk positive control (`auditDetector`) that proves this detector is not blind.
 * `apps/api` KEEPS its own sibling guard (`lib/path-containment-contract.test.ts`, on the
 * apps/api-local kit) for its ~30 in-tree adopters — that is the dependency-order split the
 * source-lint package itself documents, not a redundancy. This scan owns everything else.
 */

/** repo root: packages/path-containment/src → ../../.. */
const ROOT = join(import.meta.dir, '..', '..', '..')

/** Repo-relative, so a failure names the file the way you would open it. */
const rel = (file: string) => file.slice(ROOT.length + 1)

/**
 * The three spellings every hand-rolled ancestry copy has used — the SAME three the apps/api
 * guard names, because copies reach for the same idiom the app-side code does.
 * `apps/api` does. All three must route through `@localixai/path-containment` (its
 * `isPathWithin` / `isPathBelow` / `resolveWithin`, or the `isAtOrUnder` / `isStrictlyUnder`
 * leaf) — or appear in EXEMPTIONS, with a reason.
 */
const IDIOMS = {
  /** `x.startsWith(<expr> + sep)` / `+ path.sep` / `+ '/'`. */
  'sep-prefix': /\.startsWith\([^;\n]*?\+\s*(?:(?:path\.)?sep\b|['"`]\/['"`])/,
  /** The same idiom spelled as a TEMPLATE: ``startsWith(`${root}/`)`` / ``` `${root}${sep}` ```. */
  'sep-template': /\.startsWith\(\s*`[^`]*\$\{[^}]*\}(?:\/|\$\{\s*(?:path\.)?sep\s*\})/,
  /** `…startsWith('..')` / `startsWith('../')` — the relative-escape idiom. */
  'rel-escape': /\.startsWith\(\s*['"`]\.\./,
} as const

/**
 * The exemptions, keyed `<repo-relative-file>::<idiom>`. Keyed by file AND idiom, so a
 * blessing for one spelling does NOT silently cover a different (possibly real) one that
 * grows in the same file later — a new idiom is a new key, arriving UNBLESSED.
 *
 * Every entry here is a `startsWith` that is NOT path ancestry: a model-id namespace, a
 * shell-command prefix, a syntax sniff, or a match against a user-supplied pattern that is
 * not a filesystem root. The real containment checks in these same files (where they exist)
 * DO go through the owner.
 */
const EXEMPTIONS: Record<string, string> = {
  'apps/api/src/features/chat/runtime/model-resolution.ts::sep-template':
    'Owns the namespaced MODEL ID check (`hasProviderPrefix`) other model code calls. Not a path.',
  'apps/api/src/features/capabilities/cleanup.ts::sep-template':
    'Matches an MCP rule name `mcp:<server>/<tool>` of a removed server. Not a path.',
  'packages/agent/src/catalog/route-readiness.ts::sep-template':
    'Tests the `<providerId>/` namespace of a MODEL ID to find its owner. Not a path.',
  'packages/agent/src/catalog/model-lookup.ts::sep-template':
    'Matches namespaced MODEL IDs against provider ids during catalog lookup. Not a path.',
  'apps/ui/src/entities/chat/ui/useTranscriptJumps.ts::sep-template':
    'Matches a `localix://resource/chat/message/<session>` URI against the namespace this materializer owns. A URI namespace, not a filesystem path — routing it through the owner would apply path semantics (`..` resolution, separator normalisation) to an opaque identifier.',
  // ── other non-path prefixes ──
  // `permission-engine.ts::sep-prefix` used to sit here — a shell-command prefix match that
  // moved out of that file when the rule grammar was consolidated (8e51adfc9). Deleted, which
  // is what the staleness half of this guard asks for: an exemption that no longer matches
  // anything is a blessing nobody can check.
  'apps/api/src/features/context-fabric/policy.ts::sep-template':
    'Matches an already-RELATIVE path against a user EXCLUSION PREFIX (a glob-ish pattern, not a root). The real root-containment check in this file goes through the owner.',
  'apps/api/src/features/agent-core/tools/workspace.ts::sep-prefix':
    'A SAFE_SYSTEM_PREFIXES allow-list scan (`/usr`, `/etc`, …) — dirs a token MAY name, with no root to be contained in. Its root-containment check adopted the owner (isPathWithin).',
  'apps/api/src/features/plugins/backend-host.ts::sep-template':
    'Matches an HTTP route path against a mounted URL prefix. Not a filesystem path.',

  // ── syntax sniffs: "does this string LOOK like a path/URL?", before anything is resolved ──
  'apps/api/src/features/plugins/marketplace-source.ts::rel-escape':
    'Sniffs whether a marketplace `source` LOOKS like a local path (`./`, `../`, `/`, `~`) before it is resolved. The containment check in this same file goes through the owner.',
  'apps/api/src/features/agent-core/tools/preview/open-preview-detect.ts::rel-escape':
    'Sniffs whether an argument looks like a file path vs a URL. No root, nothing to contain.',
}

/**
 * Every first-party source tree. NOT `packages/cli/{server,public}` — those are gitignored
 * BUILD ARTIFACTS (staged bundles of everything, so they carry every idiom by construction);
 * only the CLI's own `bin`/`scripts` are source. The owner package is excluded below so its
 * own definition is not flagged.
 *
 * `sourceTree` REFUSES an empty or witness-less list: the witnesses are the very files this
 * promotion converted, so if one is moved or renamed the scan goes RED instead of silently
 * checking a tree that no longer contains the thing it was widened to protect.
 */
function firstPartySources(): string[] {
  const owner = join('packages', 'path-containment')
  return sourceTree({
    label: 'every first-party source tree',
    roots: [
      join(ROOT, 'apps', 'api', 'src'),
      join(ROOT, 'apps', 'ui', 'src'),
      join(ROOT, 'packages', 'agent', 'src'),
      join(ROOT, 'packages', 'mini-app-sdk', 'src'),
      join(ROOT, 'packages', 'visual-feedback', 'src'),
      join(ROOT, 'packages', 'dataview', 'src'),
      join(ROOT, 'packages', 'cli', 'bin'),
      join(ROOT, 'packages', 'cli', 'src'),
      join(ROOT, 'packages', 'cli', 'scripts'),
      join(ROOT, 'mini-apps'),
      join(ROOT, 'plugins'),
    ],
    mustInclude: [
      join('packages', 'agent', 'src', 'index.ts'),
      join('apps', 'ui', 'src', 'features', 'inspector', 'ui', 'fileTreePaths.ts'),
      join('packages', 'mini-app-sdk', 'src', 'ui', 'utilities.ts'),
    ],
    minFiles: 300,
  }).filter((f) => !f.includes(owner))
}

/** Every `<file>::<idiom>` hand-rolled ancestry idiom under the scanned trees. */
let cachedContainmentHits: string[] | undefined

function scanContainmentIdioms(): string[] {
  if (cachedContainmentHits) return cachedContainmentHits
  const files = firstPartySources()
  const hits: string[] = []
  for (const [idiom, re] of Object.entries(IDIOMS)) {
    for (const file of offendersIn(files, re)) hits.push(`${rel(file)}::${idiom}`)
  }
  cachedContainmentHits = hits
  return cachedContainmentHits
}

/**
 * POSITIVE CONTROL. A green run is indistinguishable from a broken detector unless the
 * detector is shown to bite. `auditDetector` plants each idiom — as the bug ONCE WRITTEN
 * and as the SAME shape sitting in a comment — one folder down (so recursion is exercised,
 * not assumed), runs the REAL detector, and requires the bug to come back and the comment
 * to stay silent. Dies if the reader stops stripping comments, if the walk stops recursing,
 * or if a regex falls out of step with the code.
 */
const SHAPES: OffenderShape[] = [
  {
    rule: 'sep-prefix',
    pattern: IDIOMS['sep-prefix'],
    bug: 'export const inside = (root, p) => p === root || p.startsWith(root + path.sep)\n',
    clean:
      '// Never `p.startsWith(root + path.sep)` by hand — route it through isPathWithin.\n' +
      'export const inside = (root, p) => isPathWithin(root, p)\n',
  },
  {
    rule: 'sep-template',
    pattern: IDIOMS['sep-template'],
    bug: 'export const inside = (root, p) => p.startsWith(`${root}/`)\n',
    clean:
      '// Never ``p.startsWith(`${root}/`)`` — that is the sibling-prefix trap, owned once.\n' +
      'export const inside = (root, p) => isAtOrUnder(root, p)\n',
  },
  {
    rule: 'rel-escape',
    pattern: IDIOMS['rel-escape'],
    bug: "export const inside = (root, p) => !path.relative(root, p).startsWith('..')\n",
    clean:
      "// Never `path.relative(root, p).startsWith('..')` — resolveWithin returns null on escape.\n" +
      'export const inside = (root, p) => resolveWithin(root, p) !== null\n',
  },
]

describe('path-containment monopoly — repo-wide', () => {
  test('the detector is provably not blind (plants each idiom on disk and requires it back)', () => {
    expect(auditDetector(SHAPES)).toEqual([])
  })

  test('every ancestry idiom outside the owner is routed through it — or exempt with a reason', () => {
    const found = scanContainmentIdioms()

    // ANTI-VOID. The exemptions below are real matches that must stay visible. Zero hits does
    // not mean a clean tree — it means the walk or the idiom regexes stopped reaching the code.
    // (`sourceTree` already proved the file list is non-empty and holds its witnesses.)
    expect(
      found.length,
      'the idiom regexes matched nothing — did IDIOMS stop matching?',
    ).toBeGreaterThan(0)

    const offenders = found.filter((key) => !(key in EXEMPTIONS))
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'Route it through @localixai/path-containment (isPathWithin / isPathBelow / resolveWithin, ' +
            'or the isAtOrUnder / isStrictlyUnder leaf) — or, if it is genuinely not path ancestry, add ' +
            `it to EXEMPTIONS in this file WITH A REASON:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  }, 20_000)

  test('the exemption list has no stale entries (every blessing is still a real match)', () => {
    const found = new Set(scanContainmentIdioms())
    const stale = Object.keys(EXEMPTIONS).filter((key) => !found.has(key))
    expect(
      stale,
      stale.length === 0
        ? ''
        : `These EXEMPTIONS no longer match anything — delete them:\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  }, 20_000)
})
