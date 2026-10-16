/**
 * CliContext — the host facts the JS launcher (`bin/localix.mjs`) resolves and
 * injects, so the TypeScript CLI never has to reason about how it was invoked
 * (published bundle vs. repo source). This is the seam between the thin JS bin
 * layer and the typed CLI layer.
 */
export interface CliContext {
  /** CLI package version, printed by `--version`. Best-effort. */
  version?: string | null
}
