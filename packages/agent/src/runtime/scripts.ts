/**
 * SCRIPTS: model-written JavaScript whose only capability is calling the tools it is handed.
 *
 * The port an engine offers so a `Workflow` script can chain, parallelise and filter tool calls. What
 * the sandbox is (an engine detail) stays behind this port; a script reaches exactly the `tools` of
 * its request — no file system, network, timers or modules.
 */

/** One tool a script may call, as `tools.<name>(input)`. */
export interface ScriptTool {
  name: string
  description: string
  /** JSON Schema of the input; not validated here. */
  inputSchema: Record<string, unknown>
  /**
   * The call. Resolves to what the script receives; rejects with an Error whose message the script
   * sees. The caller owns validation, permission and hooks — the sandbox only relays.
   */
  execute(input: unknown, signal: AbortSignal): Promise<unknown>
}

export interface ScriptRunRequest {
  code: string
  tools: readonly ScriptTool[]
  /** Overall deadline, tool time included. */
  timeoutMs: number
  signal?: AbortSignal
}

/** What the script produced, in order: `text()`/`console.*` lines, and images. */
export type ScriptOutputItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/** `output` is kept for a failed run too, up to the failure. */
export type ScriptRunResult =
  | { ok: true; value: unknown; output: ScriptOutputItem[] }
  | { ok: false; error: { message: string; stack?: string }; output: ScriptOutputItem[] }

export interface ScriptSandbox {
  /** Never rejects for the script's own failure; that is `ok: false`. */
  run(request: ScriptRunRequest): Promise<ScriptRunResult>
}
