/// <reference types="bun" />

import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import path from 'node:path'

import {
  assertNotVoid,
  scanSources,
  stripComments,
  withPlantedSources,
} from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * EVERY FIELD A SUBSYSTEM CAN CONTRIBUTE MUST ACTUALLY BE CONSUMED.
 *
 * `BackendSubsystem` is the OPEN seam any bundled workbench uses to contribute wiring that core
 * would otherwise hardcode: a route mount, a
 * `<scheme>://` resource provider, a search provider, context providers, WS frames, a
 * shutdown hook. Core names none of the four plugins — it just loops over the registry.
 *
 * WHICH MEANS A CONTRIBUTION CAN BE SILENTLY IGNORED. Add a field to `BackendSubsystem`,
 * thread it through `loadPluginBackends`, ship a plugin that populates it — and if nobody
 * added the consumption loop in the composition root, NOTHING FAILS. The plugin's
 * contribution just never happens. Type-check is green (the field is optional), the
 * plugin's own tests are green (they assert the backend RETURNS the field), and the
 * feature is dead. The failure is an ABSENCE, and absences are invisible to ordinary
 * tests.
 *
 * WHY loader-backends.test.ts DOES NOT COVER THIS, THOUGH IT LOOKS LIKE IT DOES. That
 * test's `it('wires the backend into the registries the way bootstrap does')` builds its
 * OWN registries and runs its OWN copies of the three loops ("Mirror bootstrap", "mirror
 * app.ts's subsystem route loop", "mirror index.ts's shutdown loop"). It therefore proves
 * the contribution SHAPE is consumable — a real and useful claim — but it cannot observe
 * the composition root at all. Delete the registration loop from bootstrap.ts and every
 * assertion in it still passes: it is asserting against a reimplementation of the code
 * under test. This file is the half that was missing.
 *
 * The consumption sites are deliberately spread (route mounts in `createApp`, provider
 * registration in `bootstrap`, teardown in `index`), and they are interleaved with
 * diagnostics and ordering that resist a single shared extraction — so rather than force
 * one, the rule is enforced structurally: the field exists ⇒ someone reads it.
 */

/** The file that DECLARES what a subsystem may contribute. */
const CONTRACT = 'packages/plugin-sdk/src/backend/subsystem.ts'

/**
 * The composition root, in full. The live wiring (route mounts, provider + WS-frame +
 * capability registration, per-plugin teardown) lives in the plugin backend HOST
 * (features/plugins/backend-host.ts) — bootstrap builds it, `createApp` mounts its
 * dispatcher middleware, `boot/search.ts` hands it the search registry, and process
 * shutdown in `index.ts` still runs each subsystem's `onShutdown`. The host's exact-scope
 * UI-action table (`backend-host-ui-actions.ts`) is where `uiActions` is read.
 */
const ROOTS = [
  'apps/api/src/app.ts',
  'apps/api/src/bootstrap.ts',
  'apps/api/src/index.ts',
  'apps/api/src/boot/search.ts',
  'apps/api/src/features/plugins/backend-host.ts',
  'apps/api/src/features/plugins/backend-host-ui-actions.ts',
] as const

/** Repository root: the public contract lives in the SDK; consumers live in the host. */
const SRC_ROOT = path.resolve(import.meta.dir, '..', '..', '..', '..', '..')

/**
 * COMMENTS ARE STRIPPED BY `lib/source-lint.ts`, and it is load-bearing here in BOTH
 * directions: prose NAMING a field must not be mistaken for reading it (`// TODO: consume
 * s.onShutdown one day` would otherwise satisfy the whole contract), and a real consumption
 * loop must not be masked by a trailing comment on its line. The stripper this file used to
 * carry was line-based and missed the second case.
 */

/**
 * The property names declared by `interface <name>` in `source`.
 *
 * SYMBOL-ANCHORED, not a line span: it finds the interface by name and reads to its
 * MATCHING brace, so re-ordering the file, or growing the interface, cannot make the
 * extractor quietly read the wrong region (or half of one).
 */
export function interfaceFields(source: string, name: string): string[] {
  const code = stripComments(source)
  const start = code.search(new RegExp(String.raw`\binterface\s+${name}\b[^{]*\{`))
  if (start < 0) return []
  const open = code.indexOf('{', start)

  let depth = 0
  let end = -1
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  if (end < 0) return []

  const fields: string[] = []
  let depthInBody = 0
  for (const line of code.slice(open + 1, end).split('\n')) {
    // Only TOP-level members: skip anything nested inside an inline object type.
    if (depthInBody === 0) {
      const m = /^\s*(\w+)\s*\??\s*:/.exec(line)
      if (m) fields.push(m[1])
    }
    for (const ch of line) {
      if (ch === '{') depthInBody++
      else if (ch === '}') depthInBody--
    }
  }
  return fields
}

/** Is `field` READ anywhere in `source` (`.field`, or destructured `{ field }`)? */
export function isConsumed(source: string, field: string): boolean {
  const code = stripComments(source)
  return new RegExp(String.raw`\.${field}\b|\{[^}\n]*\b${field}\b[^{\n]*\}\s*=`).test(code)
}

/**
 * Fields DECLARED by the contract but read by NO root, under `root`.
 *
 * ROOT-PARAMETERIZED, which is the seam the positive control uses: it plants a contract with
 * an extra field plus a root that ignores it, and proves this exact function names it.
 */
async function ignoredFields(root: string): Promise<string[]> {
  const files = await scanSources({
    root,
    include: [CONTRACT, ...ROOTS],
    strip: (s) => s, // both extractors strip for themselves (they read structure, not tokens)
    minFiles: 1 + ROOTS.length,
  })
  const contract = files.find((f) => f.file === CONTRACT)
  const fields = interfaceFields(contract?.raw ?? '', 'BackendSubsystem')

  // ANTI-VOID. Without it, a renamed interface / moved file makes `fields` empty and the
  // filter below iterates NOTHING — a guard that checks nothing passes forever.
  assertNotVoid(
    'field of `BackendSubsystem`',
    fields.length,
    `Looked in ${CONTRACT}. Was the interface renamed?`,
  )

  const roots = files
    .filter((f) => f.file !== CONTRACT)
    .map((f) => f.raw)
    .join('\n')
  return fields.filter((f) => !isConsumed(roots, f))
}

describe('BackendSubsystem: every contributable field is consumed by the composition root', () => {
  test('no field of the contract is declared-but-ignored', async () => {
    const fields = interfaceFields(
      (await scanSources({ root: SRC_ROOT, include: [CONTRACT] }))[0]?.raw ?? '',
      'BackendSubsystem',
    )
    expect(
      fields.length,
      'BackendSubsystem parsed to zero fields — the extractor lost the interface',
    ).toBeGreaterThan(3)
    expect(fields).toContain('routeMount')

    const ignored = await ignoredFields(SRC_ROOT)
    expect(
      ignored,
      ignored.length === 0
        ? ''
        : `\n${ignored.length} BackendSubsystem field(s) are DECLARED but never read by the\n` +
            `composition root (${ROOTS.join(', ')}):\n  ${ignored.join('\n  ')}\n\n` +
            `A plugin can populate these and nothing will happen — no error, no warning, the\n` +
            `contribution is simply dropped. Add the consumption loop, or delete the field.\n`,
    ).toEqual([])
  })

  /**
   * POSITIVE CONTROL, ON DISK. The goal state is ZERO ignored fields, so a green run is
   * indistinguishable from a detector that lost the interface — the SYNTHETIC controls below
   * pin the two extractors, and this one pins the WHOLE pipeline (walk → parse → consumption
   * check) against a real tree. Plant the original bug: a field the roots never read.
   */
  test('POSITIVE CONTROL — a declared-but-unconsumed field is named; commented-out consumption does not count', async () => {
    const contract = `export interface BackendSubsystem {\n  id: string\n  routeMount?: { path: string; app: Hono }\n  onShutdown?: () => void\n}\n`
    const plant = (shutdownLoop: string): Record<string, string> => ({
      [CONTRACT]: contract,
      [ROOTS[0]]: `for (const s of reg.list()) { if (s.routeMount) app.route(s.routeMount.path, s.routeMount.app) }\nconst id = s.id\n`,
      [ROOTS[1]]: '',
      [ROOTS[2]]: shutdownLoop,
      [ROOTS[3]]: '',
      [ROOTS[4]]: '',
      [ROOTS[5]]: '',
    })

    // 1. The bug: nothing reads `onShutdown`. The detector must name it.
    expect(await withPlantedSources(plant(''), ignoredFields)).toEqual(['onShutdown'])

    // 2. THE CLASS: a consumption loop that is COMMENTED OUT is not a consumption loop. A
    //    comment-blind scan reads it as one and reports a clean tree — the contribution is
    //    dropped at runtime and nothing is red.
    expect(
      await withPlantedSources(
        plant('// for (const s of reg.list()) s.onShutdown?.()\n'),
        ignoredFields,
      ),
    ).toEqual(['onShutdown'])

    // 3. And the real loop clears it.
    expect(
      await withPlantedSources(
        plant('for (const s of reg.list()) s.onShutdown?.()\n'),
        ignoredFields,
      ),
    ).toEqual([])
  })
})

/**
 * SYNTHETIC POSITIVE CONTROLS. The goal state above is ZERO ignored fields, so a hit-count
 * rule is unavailable — the detector must instead be shown to FIRE on the shape of the
 * original bug (a declared, unconsumed field) and to stay silent on the shape of correct
 * code. Without these, a detector that matches nothing looks exactly like a clean tree.
 */
describe('the detector itself', () => {
  const CONTRACT_SRC = `
    export interface BackendSubsystem {
      id: string
      routeMount?: { path: string; app: Hono }
      onShutdown?: () => void
    }
    export interface Decoy { neverMe: string }
  `

  test('reads the named interface, its top-level fields only, and not a sibling', () => {
    expect(interfaceFields(CONTRACT_SRC, 'BackendSubsystem')).toEqual([
      'id',
      'routeMount',
      'onShutdown',
    ])
    // `path`/`app` are nested inside routeMount's inline object type — not contract fields.
    expect(interfaceFields(CONTRACT_SRC, 'BackendSubsystem')).not.toContain('path')
    expect(interfaceFields(CONTRACT_SRC, 'BackendSubsystem')).not.toContain('neverMe')
  })

  test('returns [] for an interface that is not there (so the anti-void check can catch it)', () => {
    expect(interfaceFields(CONTRACT_SRC, 'Renamed')).toEqual([])
  })

  test('FIRES on the bug: a field the root never reads', () => {
    const root = `for (const s of reg.list()) { if (s.routeMount) app.route(s.routeMount.path, s.routeMount.app) }`
    expect(isConsumed(root, 'routeMount')).toBe(true)
    expect(isConsumed(root, 'onShutdown')).toBe(false) // declared in the contract, read by nobody
  })

  test('does not mistake PROSE about a field for a use of it', () => {
    expect(
      isConsumed(`// TODO: consume s.onShutdown one day\n * onShutdown is nice`, 'onShutdown'),
    ).toBe(false)
  })

  test('counts a destructured read, not only a member access', () => {
    expect(isConsumed(`const { wsFrames } = backend`, 'wsFrames')).toBe(true)
  })
})
