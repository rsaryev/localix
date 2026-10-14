/**
 * Fail the test run when it leaves NEW keys on `globalThis`.
 *
 * `bun test` shares ONE process across every file and does not run files in the order they
 * are passed. So a test that installs a global and forgets to remove it changes what later
 * files see — and which files those are depends on discovery order. That produced a real
 * failure: `getDesktopApiPort > undefined when there is no window` passed alone and in
 * `apps/ui/src`, but failed in `apps/api/src/features apps/ui/src packages`, because
 * visual-feedback's `postmessage.test.ts` had installed a fake `window` and never deleted it
 * (`6f89b15e2`). Reversing the argument order changed nothing, which is what made it
 * confusing. Every full-suite run before that fix had been reporting on a polluted process.
 *
 * This is a RATCHET, not a clean bill of health. `BASELINE` lists the keys a full run leaks
 * today — 30-odd of them are a bundled tslib's helper family and zod's registry, which are
 * not ours to fix. New leaks fail; a baseline entry that stops leaking must be deleted, so
 * the list only shrinks.
 *
 * Granularity is the RUN, not the file: hooks registered from a preload fire once for the
 * whole run (measured), so the failure names the leaked KEY and you grep for it. That is a
 * far cheaper hunt than the bisection the original defect required.
 */

import { afterAll, beforeAll } from 'bun:test'

/**
 * Keys a full run leaks today. Each line is debt, not permission.
 *
 * Grouped by owner so the next reader can tell "someone else's bundled runtime" from "our
 * test forgot a cleanup", because only the second kind is worth anyone's time.
 */
const BASELINE: ReadonlySet<string> = new Set([
  // ── Third-party runtimes: installed on import, no teardown offered ──────────────────
  '__zod_globalConfig',
  '__zod_globalRegistry',
  'IS_REACT_ACT_ENVIRONMENT',
  '__reactRouterVersion',
  // A bundled tslib used to install its whole helper family here (32 keys, `__extends` through
  // `__rewriteRelativeImportExtension`). It stopped: with plugin backends activated lazily from
  // their manifests, a full run no longer eagerly imports the TS-compiled dependency that
  // carried tslib, so the helpers never reach globalThis. Deleted per this file's own rule that
  // the list may only shrink — if an eager import brings them back, the guard fails and they
  // must be re-added WITH the reason, not restored silently.
  // ── Ours: test scaffolding that outlives its file ───────────────────────────────────
  '__board',
  'toggleTheme',
  '__boom',
  '__vfEvalX',
  '__channelTestReply',
  '__channelTestStopped',
  '__TEST_SUB_STOP__',
  '__TEST_SUB_SHUTDOWN__',
  // ── Ours, and the dangerous kind: these SHADOW real host APIs ───────────────────────
  // A later file that probes for one of these sees a stub instead of "absent", which is
  // exactly how the `window` defect above went unnoticed. Shrink these first.
  'requestAnimationFrame',
  'FileReader',
  'MediaRecorder',
])

let baselineKeys = new Set<string>()

beforeAll(() => {
  baselineKeys = new Set(Object.keys(globalThis))
})

afterAll(() => {
  const leaked = Object.keys(globalThis).filter(
    (key) => !baselineKeys.has(key) && !BASELINE.has(key),
  )
  const stale = [...BASELINE].filter(
    (key) => baselineKeys.has(key) || !Object.hasOwn(globalThis, key),
  )

  if (leaked.length > 0) {
    throw new Error(
      `[test-globals] this run left ${leaked.length} NEW key(s) on globalThis: ` +
        `${leaked.join(', ')}\n` +
        'A leaked global changes what every later test file sees, and file order is not the\n' +
        'order you passed them — so this is a failure that will appear and disappear on its\n' +
        'own. Delete the global in an afterEach/afterAll (DELETE it; assigning `undefined`\n' +
        'leaves the key behind), or add it to BASELINE in scripts/test-globals-guard.ts with\n' +
        'a reason if it belongs to a third-party runtime.',
    )
  }

  // An allowlist that only grows is how the original defect survived, so entries that stop
  // leaking have to be deleted. But that claim only holds for a FULL run: a partial one simply
  // never loads most of these, and failing every `bun test <one dir>` would make the guard
  // something people route around. Hence the opt-in — `bun run check:globals` sets it.
  if (process.env.TEST_GLOBALS_STRICT === '1' && stale.length > 0 && leaked.length === 0) {
    throw new Error(
      `[test-globals] ${stale.length} BASELINE entr(ies) no longer leak: ${stale.join(', ')}\n` +
        'Delete them so the list keeps shrinking.',
    )
  }
})
