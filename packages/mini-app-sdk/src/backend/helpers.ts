import type { AgentToolResult } from '@localixai/agent/agents'

/**
 * Result of `helpers.extractReadable` — structural mirror of the host's
 * Readability extraction (`apps/api` web tools own the implementation).
 */
export interface ReadableResult {
  /** Extracted body — Markdown or plain text depending on `mode`. */
  text: string
  /** Article/document title when one was found. */
  title?: string
}

/**
 * Shared utilities handed to every plugin as `ctx.helpers` — the patterns every
 * native plugin used to copy-paste (config coercion, the standard error-result
 * shape, the abort+timeout controller dance, JSON state files). A plugin may
 * still inline its own copies (older plugins keep working), but new code should
 * reach for these. The host (`apps/api`) implements this interface.
 */
export interface PluginHelpers {
  /** Coerce a config value to a finite number without the `|| default` trap (0 / "0" are valid). */
  configNumber(value: unknown, fallback: number): number
  /** Coerce a config value to a boolean ("true"/"1" are true). */
  configBoolean(value: unknown, fallback: boolean): boolean
  /** Coerce a config value to a non-empty trimmed string, else the fallback. */
  configString(value: unknown, fallback?: string): string
  /** The standard error tool-result shape (content + `error` payload). */
  errorResult(
    content: string,
    opts?: { userMessage?: string; retryable?: boolean },
  ): AgentToolResult
  /**
   * Link the agent's abort signal with a timeout: returns a signal that aborts
   * when EITHER fires. Call `dispose()` in a finally block; `didTimeout()`
   * distinguishes "timed out" from "user aborted" in the error message.
   */
  withTimeoutSignal(
    parent: AbortSignal | undefined,
    timeoutMs: number,
  ): {
    signal: AbortSignal
    didTimeout(): boolean
    dispose(): void
  }
  /**
   * Read a JSON file, returning `fallback` when it is missing or unparsable.
   * The parsed value is `unknown` on purpose — the file's contents are whatever
   * happens to be on disk, not the fallback's type. Pass a type guard to get `T`
   * back SOUNDLY: the guard runs against the parsed value, and a file that fails
   * it takes the same `fallback` path as a missing one.
   */
  readJson(filePath: string, fallback?: unknown): Promise<unknown>
  readJson<T>(filePath: string, fallback: T, isValid: (value: unknown) => value is T): Promise<T>
  /** Write a JSON file (parent dirs created). */
  writeJson(filePath: string, value: unknown): Promise<void>
  /** Decode the common named + numeric HTML character references. */
  decodeEntities(s: string): string
  /** Strip HTML to readable plain text (no DOM parser — good enough for reading pages). */
  htmlToText(html: string): string
  /** Strip tags + decode + collapse whitespace — for one-line snippets. */
  stripToText(s: string): string
  /**
   * Isolate a page's main article (drops nav/footer/cookie chrome) via Readability
   * and return it as Markdown (`mode:'markdown'`) or plain text (`mode:'text'`),
   * with the `<title>`. Falls back to `htmlToText` when Readability can't parse —
   * never throws. Heavy libs load lazily on first use.
   */
  extractReadable(html: string, url: string, mode: 'markdown' | 'text'): Promise<ReadableResult>
}
