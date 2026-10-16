/**
 * What the vendored pi fork IS: where upstream lives, which of its packages we carry, which paths
 * never come along, and which tests prove the Localix delta survived a merge.
 *
 * One module, so the snapshot builder, the merge and the pre-commit detector cannot disagree about
 * any of it.
 */

export const UPSTREAM_URL = 'https://github.com/earendil-works/pi'
export const UPSTREAM_BRANCH = 'main'
export const VENDOR_DIR = 'vendor/pi'
export const UPSTREAM_DOC = `${VENDOR_DIR}/UPSTREAM.md`

/** The four packages this repository vendors; everything else upstream ships is not ours. */
export const PACKAGES = ['packages/ai', 'packages/agent', 'packages/chord', 'packages/telemetry']

/**
 * Upstream paths the snapshot does NOT carry, whatever arrives under them.
 *
 * The snapshot is source: what the adapter imports, the tests that guard the deltas, and the
 * documents that explain the code. Upstream's `docs/pico/` is none of those — design handoffs,
 * working notes and, at `59eb4c39`, a 312 KB zip of a harness draft that pushed `vendor/pi` through
 * the ceiling `scripts/vendor-boundary.test.ts` holds. Pruning here keeps that ceiling meaningful;
 * the same test refuses these paths if they return.
 */
export const PRUNED = ['packages/agent/docs/pico/']

/**
 * The guard for every delta `UPSTREAM.md` documents. A merge that drops one is what these catch.
 *
 * Each names the runner its package declares: pi's own suites are vitest, and under `bun test` they
 * fail for reasons that have nothing to do with the fork (the Codex OAuth and stream suites use
 * `vi.*`). A guard run under the wrong runner is red noise, and a guard that is always red is
 * skipped by habit — which is how the Codex OAuth recovery went unguarded before this list named it.
 */
export const TRIPWIRES: ReadonlyArray<{ path: string; delta: string }> = [
  {
    path: `${VENDOR_DIR}/packages/agent/test/agent-loop.test.ts`,
    delta: 'modelTools, tool progress pump, mixed tool scheduler',
  },
  { path: `${VENDOR_DIR}/packages/ai/test/oauth-page.test.ts`, delta: 'Localix OAuth pages' },
  {
    path: `${VENDOR_DIR}/packages/ai/test/generated-catalog.test.ts`,
    delta: 'generated-catalog conversion in src/, runtime refresh, dynamic provider overlay',
  },
  {
    path: `${VENDOR_DIR}/packages/ai/test/openai-chatgpt-oauth.test.ts`,
    delta: 'host application name for ChatGPT registration',
  },
  {
    path: `${VENDOR_DIR}/packages/ai/test/openai-codex-oauth.test.ts`,
    delta: 'Codex OAuth login recovery',
  },
  {
    path: `${VENDOR_DIR}/packages/ai/test/openai-codex-stream.test.ts`,
    delta: 'Codex session cleanup',
  },
  { path: 'packages/agent-runtime-pi/src/cache-anchor.test.ts', delta: 'Anthropic cache anchor' },
  {
    path: 'packages/agent-runtime-pi/src/tool-argument-coercion.test.ts',
    delta: 'stringified structured arguments',
  },
  { path: 'packages/agent-runtime-pi/src/tool-scheduling.test.ts', delta: 'mixed tool scheduler' },
  {
    path: 'packages/agent-runtime-pi/src/catalog.test.ts',
    delta: 'catalog refresh through Models.refresh',
  },
]

/** Commit trailers that make a snapshot findable in history, so the merge base is git's own. */
export const TRAILER_UPSTREAM = 'Vendor-Upstream'
export const TRAILER_VERSION = 'Vendor-Version'

/**
 * Network ceilings. A hung fetch inside a pre-commit hook freezes every commit on the machine —
 * observed: a shallow fetch that sat for ten minutes at zero CPU. Past these the upstream counts as
 * unreachable, which the detector reports and moves past rather than blocking on.
 */
export const LS_REMOTE_TIMEOUT_MS = 15_000
export const FETCH_TIMEOUT_MS = 180_000
export const INSTALL_TIMEOUT_MS = 300_000
export const TRIPWIRE_TIMEOUT_MS = 180_000
