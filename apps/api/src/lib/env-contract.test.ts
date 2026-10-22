import { describe, expect, setDefaultTimeout, test } from 'bun:test'
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

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * THE ENV CONTRACT, ENFORCED.
 *
 * `env.ts` states the rule ("never `process.env.X` at a call site") and — until
 * this file existed — claimed a test enforced it. It didn't, and six call sites
 * quietly hand-rolled their own parse. A rule nobody checks is folklore, so here
 * is the check.
 *
 * WHAT COUNTS AS A READ. `process.env` used as a WHOLE OBJECT is not a read — it
 * is boundary plumbing (`{ ...process.env }` into a child spawn, `deps.env ??
 * process.env` as an injectable source, `env.ts`'s own default params). Those are
 * exactly what the helpers themselves do, and they carry no per-var parsing rule.
 * A read is `process.env.NAME` or `process.env[…]`: a specific value pulled out
 * and interpreted at the call site. Those must go through `lib/env.ts` —
 * `loadEnv` for boot config, `envFlag`/`envInt`/`envString` for the ad-hoc ones —
 * or appear below with a reason.
 *
 * TWO KINDS OF EXCEPTION LIVE HERE:
 *  - {@link OS_VARS}: the machine's own environment (HOME, SHELL, PATH …). Not
 *    Localix configuration, not something `env.ts` should own or re-spell. A
 *    CATEGORY, not a blessing — it needs no per-file entry.
 *  - {@link EXEMPTIONS}: everything else, keyed `<file>::<VAR>` so a blessed file
 *    that starts reading a DIFFERENT var loses its blessing for that var.
 *
 * SCOPE: `apps/api/src` ONLY, AND THAT IS CORRECT — DO NOT "FIX" IT BY WIDENING.
 *
 * It looks like a hole (a `LOCALIX_*` var hand-parsed in a base package would be invisible
 * to this scan), and it has been filed as one. It is not. The rule is "route the read
 * through `lib/env.ts`", and `lib/env.ts` is an apps/api MODULE: `@localixai/api` exports
 * no `./lib/env` subpath, so `packages/agent` and `apps/ui` cannot import it. Widening
 * this scan would enforce a rule those trees have no way to obey — and a guard that fails
 * a change nobody can make is a guard people learn to switch off.
 *
 * The scan was run repo-wide to confirm the scope is currently harmless as well as
 * correct. Outside apps/api, no RUNTIME module hand-parses a `LOCALIX_*` var. What is
 * left is the machine environment (`NODE_ENV`, `HOME`, `USERPROFILE`, `USERNAME` — the
 * OS_VARS category) plus two BOOT-TIME files that run before any module graph exists and
 * so could not import `env.ts` even if it were exported: `apps/ui/vite.config.ts`
 * (`LOCALIX_DEV_UI_PORT`, `VITE_*`) and the CLI's plain-JS launcher
 * `packages/cli/bin/localix.mjs` (`LOCALIX_USE_BUNDLED`). And
 * `apps/landing/src/generated/docs.ts` only *contains* the environment-variables doc page
 * as generated markdown, not a real read.
 *
 * If Localix config ever must be read outside apps/api, the fix is to PROMOTE the owner
 * (export `lib/env.ts` as an `@localixai/api` subpath, or move it to a package) and widen
 * this scan to follow it — never to widen the scan alone.
 *
 * MECHANICS come from `lib/source-lint.ts` — the comment stripper, the recursing walk, the
 * anti-void assertion, the two-halved exemption list, and the on-disk positive control. Nine
 * lints used to hand-roll those and each got a different subset wrong; see that file's header.
 */

/** The owner. The one file allowed to touch `process.env` by name. */
const OWNER = 'src/lib/env.ts'

/** Machine/OS environment — read directly wherever needed, `env.ts` is not its owner. */
const OS_VARS = new Set([
  'HOME',
  'USERPROFILE',
  'SHELL',
  'PATH',
  'ZDOTDIR',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'LOCALAPPDATA',
])

/**
 * KEYED `<file>::<VAR>`, not by file alone. A file blessed for one var is not blessed for
 * the next one it grows — which is the point: all three entries below are blessed for a
 * COMPUTED key (`<dynamic>`), and the moment one of them reads a FIXED var it must come
 * back here and say why.
 */
const EXEMPTIONS: Exemptions = {
  [exemptionKey('src/features/plugins/authoring/ui-build.ts', 'NODE_ENV')]: {
    reason:
      'Not a read: `process.env.NODE_ENV` is the KEY of the plugin UI bundler\'s `define`, which replaces that expression in the browser artifact with "production".',
  },
  [exemptionKey('src/lib/login-shell-env.ts', '<dynamic>')]: {
    reason:
      'IS the process.env boundary: repairs a GUI launch by folding the login-shell env INTO process.env. It writes ambient env by design.',
  },
  [exemptionKey('src/features/mods/api/system-api.ts', '<dynamic>')]: {
    reason:
      "A mod's `$.env.get(name)`: Claude Code's mods API reads the variable the mod names, as its processes would see it. No fixed var to route.",
  },
  [exemptionKey('src/features/cc-hooks/http.ts', '<dynamic>')]: {
    reason:
      'Expands ${VAR} references inside user-authored CC hook configs — the var NAME comes from the config, gated by an allowed-keys set. No fixed var to route.',
  },
  [exemptionKey('src/features/ext/user-config-substitute.ts', '<dynamic>')]: {
    reason:
      'Passes host env through to a plugin MCP server, but ONLY for keys the plugin manifest DECLARED. The var name comes from the manifest. (Was `mcp.ts`; the substitution logic was extracted to this module unchanged — same gate, same reason.)',
  },
}

/** A `process.env` READ — `.NAME`, `['NAME']`, or a computed `[expr]`. A bare
 *  `process.env` (spread / passed as a source) deliberately does not match. */
const READ_RE =
  /process\.env(?:\.([A-Za-z_$][\w$]*)|\[\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*\]|\[)/g

const API_ROOT = path.resolve(import.meta.dir, '..', '..')

/** Every `<file>::<VAR>` read of `process.env` under `root`, OS vars filtered out.
 *  ROOT-PARAMETERIZED: the positive control below runs this exact function against a
 *  planted tree, so what is proved is the REAL detector, not a restatement of its regex. */
async function scanEnvReads(root: string): Promise<string[]> {
  const files = await scanSources({
    root,
    include: ['src/**/*.ts'],
    skip: (f) => f === OWNER || f.endsWith('.test.ts'),
  })
  const hits: string[] = []
  for (const f of files) {
    for (const m of f.code.matchAll(READ_RE)) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '<dynamic>'
      if (OS_VARS.has(name)) continue
      hits.push(exemptionKey(f.file, name))
    }
  }
  return [...new Set(hits)]
}

describe('env contract', () => {
  test('every process.env read outside lib/env.ts is an OS var or explicitly exempt', async () => {
    const found = await scanEnvReads(API_ROOT)

    // ANTI-VOID. The three exemptions below are real reads that MUST still be visible; if the
    // scan sees none of them, it is no longer reading the tree and would pass forever.
    assertNotVoid(
      '`process.env` read at all',
      found.length,
      'Did the walk, or READ_RE, stop matching?',
    )

    const { offenders } = auditExemptions(EXEMPTIONS, found)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Read it through lib/env.ts (loadEnv / envFlag / envInt / envString) — or, if it genuinely cannot be, add it to EXEMPTIONS in this file WITH A REASON:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('the exemption list has no stale entries (every blessing is still real)', async () => {
    const { stale } = auditExemptions(EXEMPTIONS, await scanEnvReads(API_ROOT))
    expect(stale, stale.length === 0 ? '' : staleReport(stale)).toEqual([])
  })

  test('a new LOCALIX_* var cannot be hand-parsed at a call site', async () => {
    // Every LOCALIX_* var is Localix's OWN configuration: it belongs to loadEnv (boot config)
    // or to envFlag/envInt/envString (ad-hoc). A raw read here is precisely the failure the
    // contract exists to prevent — a var that mis-parses its own spelling.
    const raw = (await scanEnvReads(API_ROOT)).filter(
      (key) => key.split('::')[1]?.startsWith('LOCALIX_') && !(key in EXEMPTIONS),
    )
    expect(raw).toEqual([])
  })

  /**
   * POSITIVE CONTROL — reading a lint is not verifying it.
   *
   * Plants the ORIGINAL BUG (a `LOCALIX_*` var hand-parsed at a call site) on disk, three
   * directories down, and proves the REAL detector fires on it. Then plants the SAME line
   * commented out and proves the detector stays silent — because a guard that reads its file
   * WITH the comments can be satisfied by prose, which is how a sibling lint stayed green
   * while the code it protects was commented out entirely.
   */
  test('POSITIVE CONTROL — the detector fires on a hand-parsed LOCALIX_* var, and never on a commented one', async () => {
    await assertPositiveControl({
      subject: 'a hand-parsed LOCALIX_* env var',
      file: 'src/features/some-feature/service.ts',
      offender: `export const port = Number(process.env.LOCALIX_PORT ?? '5051')\n`,
      detect: scanEnvReads,
    })
  })
})
