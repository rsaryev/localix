/**
 * HTTP hook executor (`type:"http"`) — POST the event input JSON to a configured
 * endpoint and fold the response like a command hook's stdout.
 *
 * Protocol (CC §HTTP response handling):
 *   - POST the input JSON, `Content-Type: application/json`, extra headers with
 *     `$VAR`/`${VAR}` interpolation gated by `allowedEnvVars` (unlisted → empty).
 *   - 2xx JSON body  → parsed with the shared command-hook output schema
 *     (`decision`/`permissionDecision`/`additionalContext`/…) — the ONLY way an
 *     HTTP hook can block.
 *   - 2xx plain text → context (on the context-adding events).
 *   - non-2xx / network error / timeout → NON-BLOCKING; a warning is logged and
 *     execution continues (`{}`).
 *
 * SSRF note: hook config is user-authored and trusted (the same trust level as a
 * `command` hook that can run any shell), so no host/IP allowlisting is applied —
 * a user who can add an http hook can already run arbitrary commands. Treat the
 * settings files as the trust boundary.
 *
 * Layer: api feature module. Uses global `fetch` — no chat/UI imports.
 */
import {
  CC_HOOK_MAX_OUTPUT_BYTES,
  type CcHookHandler,
  type CcHookInput,
  type CcHookOutcome,
} from './contracts'
import type { HookLogger } from './executor'
import { foldHookOutput } from './output-parse'
import { runHookHttp } from '../lifecycle-hooks/http'

/**
 * Interpolate `$VAR` / `${VAR}` in a header/url value, expanding ONLY names in
 * `allowed` (from `process.env`); every other reference resolves to the empty
 * string, per CC. A literal `$` is not escapable here (CC allows `\$` in prompt
 * text only — headers have no escape), so only `$NAME`/`${NAME}` forms expand.
 */
export function interpolateEnv(value: string, allowed: readonly string[] | undefined): string {
  const allow = new Set(allowed ?? [])
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_m, braced, bare) => {
      const name = (braced ?? bare) as string
      if (!allow.has(name)) return ''
      return process.env[name] ?? ''
    },
  )
}

/**
 * Execute one HTTP hook. Never throws — any failure (non-2xx, network error,
 * timeout, abort) resolves to a non-blocking `{}` (logged as a warning).
 */
export async function executeHttpHook(
  handler: CcHookHandler,
  input: CcHookInput,
  logger: HookLogger,
  allowPlainTextContext: boolean,
  signal?: AbortSignal,
): Promise<CcHookOutcome> {
  const label = handler.pluginName ? `plugin:${handler.pluginName}` : handler.source
  const url = interpolateEnv(handler.httpUrl ?? '', handler.httpAllowedEnvVars)
  if (!url) return {}

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  for (const [name, raw] of Object.entries(handler.httpHeaders ?? {})) {
    headers[name] = interpolateEnv(raw, handler.httpAllowedEnvVars)
  }

  const result = await runHookHttp({
    url,
    headers,
    input: JSON.stringify(input),
    timeoutMs: handler.timeoutMs,
    maxOutputBytes: CC_HOOK_MAX_OUTPUT_BYTES,
    signal,
    readBody: (status) => status >= 200 && status < 300,
  })
  if (result.kind === 'response') {
    if (result.status < 200 || result.status >= 300) {
      logger.warn(
        `[cc-hook:${label}] ${input.hook_event_name} http hook → HTTP ${result.status} — non-blocking, continuing`,
      )
      return {}
    }
    return foldHookOutput(result.body, allowPlainTextContext)
  }
  const detail =
    result.kind === 'timeout'
      ? `timed out after ${handler.timeoutMs}ms`
      : result.kind === 'aborted'
        ? 'aborted'
        : `failed: ${String(result.error)}`
  logger.warn(
    `[cc-hook:${label}] ${input.hook_event_name} http hook ${detail} — non-blocking, continuing`,
  )
  return {}
}
