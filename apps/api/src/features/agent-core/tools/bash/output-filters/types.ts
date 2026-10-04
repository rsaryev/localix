/**
 * Content-aware output filters for the bash tool's MODEL-facing result.
 *
 * A filter recognizes a command's output shape (test runner, linter, …) and
 * rewrites it into the token-cheap essence — e.g. "all tests passed → summary
 * lines only; failures → failure blocks + summary". Filters NEVER touch the
 * UI copy (`details.output`) and are guarded by never-worse + fail-safe rules
 * in the registry: an unrecognized/uncertain output always passes through raw.
 */
export interface OutputFilter {
  /** Stable name, used in the provenance marker (e.g. "bun-test"). */
  name: string
  /** Cheap gate: does this filter apply to this command/output pair? */
  detect(command: string, output: string): boolean
  /**
   * Rewrite the output. Return `null` when the parser is not confident
   * (missing summary line, unexpected shape) — the registry falls back to raw.
   * MUST preserve every failure's identity (test name + assertion/panic text).
   */
  filter(output: string): string | null
}
