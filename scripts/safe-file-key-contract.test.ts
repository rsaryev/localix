import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  withPlantedSources,
  type Exemptions,
} from '../apps/api/src/lib/source-lint'

/**
 * THE SAFE-FILE-KEY CONTRACT, ENFORCED.
 *
 * "How do I turn an untrusted key into a filename?" is a SECURITY question, and it had FOUR
 * answers with byte-identical bodies — two core stores and two plugin-owned stores. Some sat in
 * front of credential data. The input is real: every `userId` is the raw, unauthenticated
 * `x-user-id` request header (`app.ts` — `c.req.header('x-user-id')`).
 *
 * WHY A SOURCE-READING GUARD AND NOT A BEHAVIOUR TEST. A behaviour test cannot even OBSERVE
 * this defect: four copies that AGREE pass every assertion, right up until one is edited and
 * the others are not. Nothing fails, because nothing disagrees YET. The claim to enforce is
 * therefore STRUCTURAL — "the rule is declared in exactly one place" — so this guard reads the
 * source. Same shape, and same reason, as `lib/path-containment-contract.test.ts`,
 * `lib/env-contract.test.ts` and `lib/claude-config-dir.test.ts`.
 *
 * It must be a RUNTIME guard, not a compile-time one: `apps/api/tsconfig.json` excludes
 * `src/**\/*.test.ts` and `bun test` does not typecheck, so a type-level assertion in a test
 * file is checked by NOTHING.
 *
 * TWO CLAIMS, because a 5th copy can arrive two ways:
 *   1. RULE — someone re-spells the exact charset `[^A-Za-z0-9_-]`.
 *   2. CONJUNCTION — someone hand-rolls a *near* copy (same idea, tweaked charset) and joins
 *      it into a path. This is how the 5th copy realistically appears, and it is the claim
 *      that caught `memory/file-store.ts` below.
 *
 * MECHANICS come from `lib/source-lint.ts` — the comment stripper, the recursing walk, the
 * anti-void assertion, the two-halved exemption list, and the on-disk positive control.
 */

/**
 * The owner. The one file allowed to spell the rule.
 *
 * It moved OUT of apps/api and into the SDK, because half its callers are plugins and a plugin
 * cannot import the host: every plugin store was injecting it into `createUserEntityStore` by
 * relative path across the very boundary `plugin-boundary-contract.test.ts` polices. The rule is
 * no less single-owner for living in the package both sides depend on — this constant moving is
 * the whole ceremony, and the anti-void assertion below is what makes forgetting it impossible.
 *
 * THIS CONTRACT STAYS HERE, in apps/api, because its precondition is the HOST's: it reads
 * `app.ts` to prove `userId` is still self-asserted, and that file is not the SDK's to see.
 */
const OWNER = 'packages/mini-app-sdk/src/backend/safe-file-key.ts'

/**
 * Every entry here is a BLESSING, not a deferral: a CORE file that matches a claim but is genuinely a
 * different KIND. There is no `debt` escape hatch in use any more — there was one, holding the two
 * sanitizers this guard found in trees its owner could not edit, and both are now discharged
 * (`memory/file-store.ts` adopted the owner; `table/service.ts` was ruled a non-member and its
 * safety pinned). It was a temporary seam with a cleanup obligation, and the obligation came due.
 * Plugin-owned exceptions are declared beside their implementation with
 * `@safe-file-key-exemption <claim> -- <reason>`; the generic loader below discovers them.
 * This file must not become a catalog of concrete plugins.
 *
 * KEYED `<file>::<claim>`, NOT by file alone. A file blessed under CLAIM 1 ("its charset is a
 * WIRE-id sanitizer, not a file key") is NOT thereby blessed under CLAIM 2 — so the day it
 * starts joining that sanitized value into a `path.join(...)`, the CONJUNCTION claim fires and
 * the file arrives unblessed. Keyed by file, that upgrade from "same regex, different purpose"
 * to "same regex, and now it IS a path" would have been silently pre-approved.
 */
const EXEMPTIONS: Exemptions = {
  // ── Same charset, but NOT a filesystem key: a different KIND, and merging them would put a
  //    security boundary one careless edit away from a convenience tweak. Do not consolidate. ──
  // MOVED, and the ruling had to be RE-ARGUED, not just re-keyed: this rule lived in `mcp.ts`
  // under the reason "no path is built from it" — and then commit 6dd1c7b5b moved it to
  // `user-config-substitute.ts` as `pluginDataDir`, which builds EXACTLY that path
  // (`join(localixHome(), 'plugin-data', id)`). The old blessing's premise was simply false at
  // its new address, and it went unseen because CLAIM 2's `path.join` regex could not read the
  // bare `join(` spelling (see `buildsAPath`). The blessing survives on a DIFFERENT argument.
  [exemptionKey('apps/api/src/features/ext/user-config-substitute.ts', 'rule')]: {
    reason:
      'Namespaces a PLUGIN ID for `~/.localix/plugin-data/<id>`, replacing with "-" (not "_") to mirror the CC spec\'s own data-dir id. Its charset is the owner\'s exactly — `.` and `/` both die, so `..` → `--` and no separator can be re-introduced — i.e. it is traversal-safe for the same reason the owner is, it just spells the replacement differently to stay CC-compatible. NOT merged into the owner because the replacement char is part of an EXTERNAL spec, not our choice: changing it to "_" to share the owner would silently relocate every plugin\'s existing data dir. Its input is a plugin NAME from a manifest, not a userId, and a collision yields two plugins sharing a data dir — not one user reading another\'s credentials. Pinned in user-config-substitute.test.ts.',
  },
  [exemptionKey('apps/api/src/features/ext/user-config-substitute.ts', 'fileKey')]: {
    reason:
      'Same ruling as its CLAIM 1 entry above — `pluginDataDir` joins the sanitized plugin id into `~/.localix/plugin-data/<id>`. Traversal-safe: the charset admits no `.` and no `/`, so no dot-segment and no separator can survive it.',
  },
  [exemptionKey('apps/api/src/features/chat/runtime/run/attachment-spill-plan.ts', 'fileKey')]: {
    reason:
      'CLAIM 2 only (its charset admits `.`, so it is not the owner\'s rule). `sanitizeSegment` guards the dot-segment hazard EXPLICITLY with a second pass — `.replace(/^\\.+/, "_")` — so `..` → `__` before it reaches `path.posix.join`. It keys a scratch spill file by sessionId under `.localix/attachments/`, not a credential store. Newly VISIBLE (not new) once CLAIM 2 learned to read `path.posix.join`; reviewed and ruled safe on that explicit guard.',
  },
  [exemptionKey('packages/engine-models/src/wire/tool-call-ids.ts', 'rule')]: {
    reason:
      'Maps a model-given TOOL-CALL ID into the form a strict provider accepts on the wire (Anthropic, Claude on Bedrock or Vertex: `[a-zA-Z0-9_-]{1,64}`). Same charset as the owner because the provider spec says so, not because it names a file: the id only ever travels inside a request body, and nothing joins it into a path. A collision is stepped past with a salted digest, so a call and its result stay paired. Pinned in wire/prompt.test.ts.',
  },
  [exemptionKey('apps/api/src/features/mods/tool-call.ts', 'rule')]: {
    reason:
      "Spells a mod's registered tool as Claude Code names it to the model, `mcp__<plugin>__<name>`, in the charset tool names allow on the wire (`[A-Za-z0-9_-]`). The name only travels in a request's tool list and back in a tool call; nothing joins it into a path.",
  },
  [exemptionKey('apps/api/src/features/mcp/mcp-tools.ts', 'rule')]: {
    reason:
      "Spells an MCP tool as Claude Code names it, `mcp__<server>__<tool>`, with Claude Code's own replacement rule for the server and tool (`[A-Za-z0-9_-]`, every other character `_`). The name is a hook matcher alias and a wire tool name; nothing joins it into a path.",
  },
  [exemptionKey('packages/visual-feedback/src/core/identify.ts', 'rule')]: {
    reason:
      'ESCAPES the same charset for a CSS SELECTOR (`\\${ch}`) rather than replacing it. The opposite operation: it PRESERVES every character so the selector still matches, where a file key must DESTROY them. Also in a package upstream of apps/api.',
  },

  // ── Builds a filename from a sanitized key, but the rule genuinely differs ──
  [exemptionKey('apps/api/src/features/plugins/authoring/scaffold.ts', 'fileKey')]: {
    reason:
      '`toMiniAppName` slugs a model-proposed name into the PLUGIN NAME format (lower-kebab, `PLUGIN_NAME_RE`), and that name is the copy\'s folder. The owner\'s "_" would produce a name the format rejects, so the separator is the format\'s, not a choice. Traversal-safe: `[^a-z0-9]+` → "-" admits no `.` and no `/`, and the result is then VALIDATED against `PLUGIN_NAME_RE` with a fixed fallback (`my-plugin`) — reject-don\'t-coerce on top of the slug. Pinned in scaffold-name.test.ts.',
  },
  [exemptionKey('apps/api/src/features/plugins/claude-code-marketplace.ts', 'fileKey')]: {
    reason:
      "CLAIM 2 only. Its char-class replace (`canonical`) folds a marketplace name to compare it with Anthropic's reserved names, so `claude_plugins-official` reads as `claude-plugins-official`; the folded form is never a filename. The name that does become a folder is VALIDATED by `marketplaceNameProblem` (`MARKETPLACE_NAME_RE`, no `..`, no non-ASCII) and refused, not coerced. Its `join` calls read the catalog files of an already-resolved marketplace folder.",
  },
  [exemptionKey('apps/api/src/features/media/store.ts', 'fileKey')]: {
    reason:
      "Does not sanitize the key at all: `pathFor(id)` is guarded by `isMediaId(id)`, which VALIDATES the id's shape and REJECTS a bad one. Reject-don't-coerce is a stronger strategy than this owner's, not a weaker copy of it. Its char-class replace builds a file EXTENSION from a mime subtype, which is a different question. Blessed for CLAIM 2 ONLY — it does not spell the owner's charset, and if it ever does, that arrives as a NEW, unblessed key.",
  },

  // ── ADOPTED. `features/memory/file-store.ts` was the fifth copy and the weakest: its charset
  //    admitted ".", so ".." survived and steered `path.join(base,'users',slug(userId))` one
  //    level OUT of users/, onto the DEFAULT user's memory root (and "." collapsed every dot-ish
  //    id onto a shared `users/MEMORY.md`). It now imports the owner; the traversal is pinned in
  //    `memory/file-store.test.ts`. Nothing was orphaned — every id it keys on (`PRJ-<n>`,
  //    `LOCALIX-<n>`, and the UUIDs still on disk) is a FIXED POINT of the rule. ──
}

const PLUGIN_EXEMPTION_MARKER = '@safe-file-key-exemption'
const PLUGIN_EXEMPTION_RE = /^\s*\/\/\s*@safe-file-key-exemption\s+(rule|fileKey)\s+--\s+(\S.*)\s*$/

/**
 * Plugin exceptions belong to the plugin that owns the implementation. Keeping the annotation
 * beside the matching line makes removal stale-safe while keeping this host guard agnostic to the
 * installed plugin set. Only production plugin source is eligible; tests cannot bless runtime code.
 */
async function pluginOwnedExemptions(root: string): Promise<Exemptions> {
  const files = await scanSources({
    root,
    include: ['mini-apps/**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
    minFiles: 0,
  })
  const exemptions: Exemptions = {}
  for (const file of files) {
    for (const [index, line] of file.raw.split(/\r?\n/).entries()) {
      if (!line.includes(PLUGIN_EXEMPTION_MARKER)) continue
      const match = PLUGIN_EXEMPTION_RE.exec(line)
      if (!match) {
        throw new Error(
          `${file.file}:${index + 1}: malformed ${PLUGIN_EXEMPTION_MARKER}; expected ` +
            '`// @safe-file-key-exemption <rule|fileKey> -- <reason>`',
        )
      }
      const key = exemptionKey(file.file, match[1] as 'rule' | 'fileKey')
      if (key in exemptions) {
        throw new Error(`${file.file}:${index + 1}: duplicate plugin-owned exemption for ${key}`)
      }
      exemptions[key] = { reason: match[2] as string }
    }
  }
  return exemptions
}

async function allExemptions(root: string): Promise<Exemptions> {
  return { ...EXEMPTIONS, ...(await pluginOwnedExemptions(root)) }
}

/**
 * CLAIM 1 — the RULE. The exact file-key charset, in either spelling (`a-zA-Z0-9_-` /
 * `A-Za-z0-9_-`), whatever it replaces with. The charset IS the rule's signature.
 */
const RULE_RE = /\[\^(?:a-zA-Z|A-Za-z)0-9_-\]/

/**
 * CLAIM 2 — the CONJUNCTION. An allow-list char class over an alphanumeric charset, in a file
 * that also builds a path. Quantifier-tolerant on purpose: the first draft of this regex
 * required `]/` and so missed `[^A-Za-z0-9._-]+/g` — the very file (`memory/file-store.ts`)
 * that turned out to carry a real traversal. A lint that quietly matches less than it thinks
 * is worse than no lint.
 */
const CLASS_RE = /\.replace\(\s*\/\[\^[^\]]*(?:a-z|A-Z|0-9)[^\]]*\][+*]?\/[gimsuy]*\s*,/

/**
 * "…and builds a path." This USED to be `/path\.join\(/` — which saw only the
 * `import path from 'node:path'` + `path.join(...)` spelling, and was BLIND to the named
 * import (`import { join } from 'node:path'` → bare `join(...)`) and to `path.posix.join(...)`.
 * That is the majority spelling in apps/api, so CLAIM 2 was matching far less than its own
 * comment claimed — the same "quietly matches less than it thinks" failure that comment warns
 * about, one level up. Widening it surfaced `agent-core/agent-memory.ts`, which was carrying a
 * REAL dot-segment escape of exactly the `memory/file-store.ts` shape (now fixed + pinned).
 *
 * A bare `join(` alone would match `Array.prototype.join`, so the bare form is only honoured in
 * a file that actually imports it from `node:path`. `path.join`/`path.posix.join` are
 * unambiguous and need no such gate.
 */
const PATH_JOIN_RE = /\bpath\.(?:posix\.|win32\.)?join\(/
const BARE_JOIN_RE = /\bjoin\(/
const PATH_NAMED_IMPORT_RE = /import\s*\{[^}]*\bjoin\b[^}]*\}\s*from\s*'node:path'/
const buildsAPath = (code: string): boolean =>
  PATH_JOIN_RE.test(code) || (PATH_NAMED_IMPORT_RE.test(code) && BARE_JOIN_RE.test(code))

/** The trees a store could plausibly live in. */
const SCAN_GLOBS = [
  'apps/api/src/**/*.ts',
  'apps/ui/src/**/*.ts',
  'packages/*/src/**/*.ts',
  'mini-apps/**/*.ts',
]

const REPO_ROOT = path.resolve(import.meta.dir, '..')

/** Every `<file>::<claim>` in the repo. ROOT-PARAMETERIZED so the positive controls below run
 *  this exact detector against a planted tree — the REAL one, not a restatement of its regexes. */
async function scan(root: string): Promise<string[]> {
  const files = await scanSources({
    root,
    include: SCAN_GLOBS,
    skip: (f) => f.endsWith('.test.ts'),
  })
  const hits: string[] = []
  for (const f of files) {
    if (RULE_RE.test(f.code)) hits.push(exemptionKey(f.file, 'rule'))
    if (CLASS_RE.test(f.code) && buildsAPath(f.code)) hits.push(exemptionKey(f.file, 'fileKey'))
  }
  return hits
}

/** The offenders: matches that are neither the owner nor blessed. */
async function offendersIn(root: string): Promise<string[]> {
  const found = (await scan(root)).filter((k) => !k.startsWith(`${OWNER}::`))
  return auditExemptions(await allExemptions(root), found).offenders
}

describe('safe-file-key contract', () => {
  /**
   * THE ANTI-VOID ASSERTION. A lint that matches nothing is VOID, not green: move or rename
   * the owner and every other test here would pass vacuously, silently DISABLING the guard
   * instead of failing it. So first prove the detector can still see the thing it polices.
   */
  test('the detector is not void — it finds the owner and the files it exempts', async () => {
    const found = await scan(REPO_ROOT)
    const exemptions = await allExemptions(REPO_ROOT)

    assertNotVoid(
      'use of the file-key charset',
      found.length,
      'Did the walk, or the claim regexes, stop matching?',
    )
    // The owner must be visible to CLAIM 1, or CLAIM 1 is not policing the rule it names.
    expect(found).toContain(exemptionKey(OWNER, 'rule'))
    // And every exempt key must still be found — otherwise the entry describes something the
    // scan can no longer see (covered again, as the stale half, below).
    for (const key of Object.keys(exemptions)) expect(found).toContain(key)
  })

  test('CLAIM 1 + CLAIM 2 — no second copy of the rule, and no filename built from a hand-rolled key', async () => {
    const offenders = await offendersIn(REPO_ROOT)

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Import { safeFileKey } from @localixai/mini-app-sdk/backend — or, if this is genuinely NOT a filesystem key (a wire id, a CSS escape, a display name), declare a reviewed exemption beside the owner WITH A REASON:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * ══ THE TRIPWIRE ══
   *
   * `safeFileKey` is NOT injective: `a/b` and `a_b` collide (pinned in `safe-file-key.test.ts`).
   * That was a deliberate ruling, and it rests on ONE precondition:
   *
   *     userId is SELF-ASSERTED — the raw `x-user-id` header, verified by nothing.
   *
   * While that holds, the collision separates nothing, because there is nothing to separate:
   * anyone who can forge `a/b` can simply send `a_b` instead. The lossiness is not a weakness
   * in the boundary; there IS no boundary. The day `userId` becomes AUTHENTICATED, the same
   * collision becomes a cross-user credential leak — user `a/b` reading user `a_b`'s secrets
   * vault and OAuth tokens.
   *
   * A comment cannot enforce a precondition. So this test READS the precondition out of
   * `app.ts` and fails the build the moment it stops being true. You cannot land authentication
   * without tripping this, which is the entire point: the hazard is not the lossiness, it is
   * the lossiness going unnoticed. (Same source-reading idiom as the claims above.)
   */
  test('TRIPWIRE — userId is still self-asserted, which is the ONLY reason safeFileKey may be lossy', async () => {
    const sources = await scanSources({
      root: REPO_ROOT,
      include: ['apps/api/src/app.ts', 'apps/api/src/lib/request-boundary.ts'],
    })
    const appTs = sources.find((source) => source.file === 'apps/api/src/app.ts')
    const boundary = sources.find(
      (source) => source.file === 'apps/api/src/lib/request-boundary.ts',
    )

    /**
     * The exact shape of "unauthenticated": take the header, fall back to the default user.
     * Pinned as an EXPRESSION rather than sniffed for auth vocabulary, because `app.ts` legitimately
     * contains OAuth code (for PROVIDER connections — not for the user), so any "does this file
     * mention auth?" detector would cry wolf on day one. This asks the precise question instead.
     *
     * The header is now routed through `resolveRequestUserId(header, defaultUserId)` — a boundary
     * sanitizer that trims and maps a blank/whitespace header to the default user (see
     * `lib/request-identity.ts`). That is STILL self-assertion: the identity is the header, falling
     * back to the default user, with NO authentication. The precondition holds; the regex just
     * tracks the new call shape.
     */
    const SELF_ASSERTED =
      /c\.set\(\s*'userId'\s*,\s*resolveRequestUserId\(\s*c\.req\.header\('x-user-id'\)\s*,\s*defaultUserId\s*\)\s*\)/
    const MOUNTED =
      /app\.use\('\*',\s*createRequestBoundary\(deps\.defaultUserId,\s*deps\.logger\)\)/
    // A changed identity or an unmounted helper must trip the guard rather than pass on dead code.
    expect(SELF_ASSERTED.test("c.set('userId', authenticatedUser())")).toBe(false)
    expect(MOUNTED.test("app.use('*', authenticatedBoundary())")).toBe(false)

    expect(
      MOUNTED.test(appTs?.code ?? '') && SELF_ASSERTED.test(boundary?.code ?? ''),
      [
        '',
        'The way a request gets its `userId` (apps/api/src/app.ts) has CHANGED.',
        '',
        'If userId is STILL self-asserted and you only reshaped that line — re-pin the regex here.',
        '',
        'If you added AUTHENTICATION, then STOP: the SDK `safeFileKey` is NOT injective, and it was',
        'allowed to stay that way precisely BECAUSE userId was unauthenticated. `a/b` and `a_b` map',
        'to the SAME file. With real users behind it, that is a cross-user credential leak.',
        '',
        'Before shipping auth, make the key injective (append a hash/encoding of the RAW id) in the',
        'ONE owner — packages/mini-app-sdk/src/backend/safe-file-key.ts — and migrate the files already on disk under the',
        'old names. Every store keyed by this rule:',
        '  - apps/api/src/features/secrets/store.ts            (CREDENTIALS)',
        '  - apps/api/src/features/mcp/oauth/store.ts          (CREDENTIALS)',
        '  - packages/mini-app-sdk/src/backend/user-entity-store.ts (the shared per-user store primitive)',
        '  - apps/api/src/features/memory/file-store.ts',
        '  - plugin-owned stores built on the shared per-user store primitive',
        '',
        'Note if ids become UUID/opaque `sub`s, safeFileKey is ALREADY the identity function on them',
        'and injectivity may be free — check the real id shape before reaching for a hash.',
        '',
      ].join('\n'),
    ).toBe(true)
  })

  test('the exemption list has no stale entries (every blessing is still real)', async () => {
    const found = (await scan(REPO_ROOT)).filter((k) => !k.startsWith(`${OWNER}::`))
    const { stale } = auditExemptions(await allExemptions(REPO_ROOT), found)
    expect(stale, stale.length === 0 ? '' : staleReport(stale)).toEqual([])
  })

  test('plugin-owned exemptions are discovered without a host-side plugin catalog', async () => {
    await assertPositiveControl({
      subject: 'an unblessed plugin-owned file-key lookalike',
      file: 'mini-apps/sample/backend/display-name.ts',
      offender: `export const displayName = (k: string): string => k.replace(/[^A-Za-z0-9_-]/g, '-')\n`,
      detect: offendersIn,
    })

    const offenders = await withPlantedSources(
      {
        'mini-apps/sample/backend/display-name.ts': [
          '// @safe-file-key-exemption rule -- Slugs a display label; it is never a path key.',
          `export const displayName = (k: string): string => k.replace(/[^A-Za-z0-9_-]/g, '-')`,
        ].join('\n'),
      },
      async (root) => offendersIn(root),
    )
    expect(offenders).toEqual([])
  })

  /**
   * POSITIVE CONTROLS. The goal state is ZERO offenders, so a green run is indistinguishable
   * from a broken detector unless the detector is SHOWN to bite. Plant the FIFTH COPY — the
   * real shape of the bug, in the tree the walker really walks — and prove each claim fires;
   * then prove the same code, commented out, does not.
   */
  test('POSITIVE CONTROL — CLAIM 1 fires on a re-spelled charset, and never on a commented one', async () => {
    await assertPositiveControl({
      subject: 'a second copy of the file-key charset',
      file: 'apps/api/src/features/some-store/keys.ts',
      offender: `export const slug = (k: string): string => k.replace(/[^A-Za-z0-9_-]/g, '_')\n`,
      detect: offendersIn,
    })
  })

  test('POSITIVE CONTROL — CLAIM 2 fires on a NEAR copy joined into a path (the way copy #5 really arrived)', async () => {
    // `memory/file-store.ts` shipped exactly this: a tweaked charset (`.` admitted) whose
    // output was joined into a path — so `..` survived and walked one level OUT of users/.
    await assertPositiveControl({
      subject: 'a hand-rolled key sanitizer joined into a path',
      file: 'apps/api/src/features/some-store/store.ts',
      offender: [
        `import path from 'node:path'`,
        `const slug = (k: string): string => k.replace(/[^A-Za-z0-9._-]+/g, '_')`,
        `export const fileFor = (base: string, userId: string): string => path.join(base, 'users', slug(userId))`,
      ].join('\n'),
      detect: offendersIn,
    })
  })

  /**
   * The SPELLING half of CLAIM 2, and the one that actually went blind. `buildsAPath` has two
   * branches, and the control above only ever plants `import path` + `path.join(` — the form
   * that always worked. The named import (`import { join }` → bare `join(`) is the majority
   * spelling here and is exactly what the detector could not read when it hid the traversal in
   * `agent-memory.ts`; `path.posix.join(` was blind for the same reason.
   *
   * Narrowing `buildsAPath` back to `PATH_JOIN_RE.test(code)` does go red today — but only via
   * the live-tree anchor, which fires because `user-config-substitute.ts` HAPPENS to use the named
   * import. That is coverage by coincidence: this suite's own blessings moved once already
   * (mcp.ts → ext/user-config-substitute.ts), and the day that file changes its import style, the branch
   * stops being exercised and the detector can be re-narrowed with everything green — back to
   * the exact blindness that shipped the bug. A planted control does not depend on what the
   * live tree happens to look like.
   */
  test('POSITIVE CONTROL — CLAIM 2 reads the join SPELLINGS it was once blind to', async () => {
    for (const [spelling, lines] of [
      [
        'a named import + bare join() — the majority spelling, and the one that hid the traversal',
        [
          `import { join } from 'node:path'`,
          `const slug = (k: string): string => k.replace(/[^A-Za-z0-9._-]+/g, '_')`,
          `export const fileFor = (base: string, userId: string): string => join(base, 'users', slug(userId))`,
        ],
      ],
      [
        'path.posix.join()',
        [
          `import path from 'node:path'`,
          `const slug = (k: string): string => k.replace(/[^A-Za-z0-9._-]+/g, '_')`,
          `export const fileFor = (base: string, userId: string): string => path.posix.join(base, 'users', slug(userId))`,
        ],
      ],
    ] as const) {
      await assertPositiveControl({
        subject: `a hand-rolled key sanitizer joined into a path via ${spelling}`,
        file: 'apps/api/src/features/some-store/store.ts',
        offender: lines.join('\n'),
        detect: offendersIn,
      })
    }
  })
})
