/** Increment only when a client cannot safely use an older local API instance. */
// Versioned resource browsing replaced the flat `{nodes}` response. Clients must
// never attach to a runtime that cannot honor hierarchical `partial` navigation.
export const LOCALIX_API_PROTOCOL_VERSION = 4
export const LOCALIX_API_PRODUCT_ID = 'localix-api'
/** Machine-readable stdout frame emitted once a standalone runtime is ready or attached. */
export const LOCALIX_RUNTIME_READY_PREFIX = 'LOCALIX_RUNTIME_READY '

/**
 * THE CONTRACT BETWEEN THE DESKTOP SHELL (Rust) AND THIS RUNTIME. Everything below is spelled twice
 * in the product, once in each language, and a mismatch is not a build error: a changed frame prefix
 * leaves the shell waiting out its 12 s timeout, a changed shutdown word leaves a runtime holding the
 * database lease after quit. So the Rust side is GENERATED from this file
 * (`scripts/runtime-contract.mjs` writes `src-tauri/src/runtime_contract.rs`), and the check that
 * the committed copy still matches runs in `check:generated`. Change a value here, then
 * `bun scripts/runtime-contract.mjs --write`.
 */

/**
 * The stdout line a desktop runtime writes, before exiting with `RUNTIME_EXIT_OWNED_ELSEWHERE`, when
 * the data folder already belongs to a runtime that ANOTHER live desktop shell owns (a second copy
 * of the app installed at a different path). The JSON names that shell, so this one can hand the
 * user over to it instead of taking the database away from it.
 */
export const LOCALIX_RUNTIME_OWNED_ELSEWHERE_PREFIX = 'LOCALIX_RUNTIME_OWNED_ELSEWHERE '
/** EX_TEMPFAIL: "someone else has this", never a crash to restart. */
export const RUNTIME_EXIT_OWNED_ELSEWHERE = 75
/** The argument that makes the API run as the shell's child: ready frame on stdout, stdin channel. */
export const DESKTOP_RUNTIME_ARG = '--desktop-runtime'
/** The line the shell writes to the runtime's stdin to ask it to stop (followed by a newline). */
export const RUNTIME_SHUTDOWN_COMMAND = 'shutdown'
/** Environment the shell sets on the runtime: its own pid, the launch id for logs, the CLI shim. */
export const RUNTIME_ENV = {
  parentPid: 'LOCALIX_DESKTOP_PARENT_PID',
  launchId: 'LOCALIX_LAUNCH_ID',
  cliEntry: 'LOCALIX_CLI_ENTRY',
} as const
/**
 * How long the runtime waits for a sibling's endpoint before giving up. The shell's own start
 * budget must be LARGER, or the shell kills the runtime before it can say why it failed.
 */
export const RUNTIME_ATTACH_WAIT_MS = 6_000
/**
 * How long the runtime's own teardown may take. The shell's wait for `shutdown` must be LARGER, or
 * the shell kills a runtime that was about to finish cleanly.
 */
export const RUNTIME_SHUTDOWN_DEADLINE_MS = 4_000

/** The fields of the ready frame the shell reads (the frame itself is a full `RuntimeEndpoint`). */
export interface RuntimeReadyFrame {
  baseUrl: string
  pid: number
}
/** How the shell's Rust struct declares each ready-frame field. Exhaustive over `RuntimeReadyFrame`. */
export const RUNTIME_READY_FIELDS = {
  baseUrl: 'String',
  pid: 'u32',
} as const satisfies Record<keyof RuntimeReadyFrame, 'String' | 'u32'>

export interface LocalixRuntimeInfo {
  /** `draining` (served as 503) from the moment shutdown begins. */
  status: 'ok' | 'draining'
  productId: typeof LOCALIX_API_PRODUCT_ID
  instanceId: string
  protocolVersion: number
  startedAt: string
  databaseId?: string
}
