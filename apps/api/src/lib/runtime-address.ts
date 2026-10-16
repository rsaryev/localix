import { loadEnv, type AppEnv } from './env'

/**
 * Single source of truth for THIS instance's locally-reachable address and its
 * inbound-webhook URL. Previously the resolution rule (loopback-normalize the
 * bind host, apply the PORT, append the webhook route path) was duplicated in
 * three places — the chat runtime's system-prompt builder AND the delegation-command
 * plugin's `prepare-delegation.sh` (which reimplemented it verbatim from a comment).
 * Anything that needs to hand a same-machine caller (a delegated CLI, the system
 * prompt, a plugin) a way to reach us resolves it HERE.
 */

/**
 * The inbound-webhook route path, DECOMPOSED into the two halves its two owners
 * actually mount, so the full path is derived rather than restated.
 *
 * This value is not cosmetic: it is what `resolveWebhookUrl` hands the agent in its
 * system prompt (and, via `$CLAUDE_WEBHOOK_URL`, what the delegation commands
 * bakes into a delegated CLI's report-back protocol). If the mount and this constant
 * drift, the agent is told an address that 404s and every delegated report-back dies
 * — with no compile error, because until now all three statements of the path were
 * independent string literals held together only by a comment.
 */
export const WEBHOOK_MOUNT_PATH = '/rpc/webhook'
/** Sub-route mounted INSIDE the webhook app (see `features/webhook/routes.ts`). */
export const WEBHOOK_MESSAGES_SUBPATH = '/messages'
/** Full inbound-webhook path — derived, never retyped. */
export const WEBHOOK_MESSAGES_PATH = `${WEBHOOK_MOUNT_PATH}${WEBHOOK_MESSAGES_SUBPATH}` as const

export interface RuntimeAddress {
  /** Loopback-normalized host reachable by callers on the same machine. */
  host: string
  /** The listen port. */
  port: number
  /** Absolute origin, e.g. `http://127.0.0.1:5051`. */
  baseUrl: string
}

/** Convert a bind host into the host local clients can dial. */
export function dialableRuntimeHost(host: string): string {
  return host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host
}

/** Format one canonical, IPv6-safe local origin for descriptors, hooks and prompts. */
export function dialableRuntimeBaseUrl(host: string, port: number): string {
  const dialable = dialableRuntimeHost(host)
  const formatted = dialable.includes(':') && !dialable.startsWith('[') ? `[${dialable}]` : dialable
  return `http://${formatted}:${port}`
}

/** Whether an endpoint origin is dialable through the exact host a client embeds. */
export function runtimeBaseUrlMatchesHost(baseUrl: string, requiredHost: string): boolean {
  try {
    return new URL(baseUrl).hostname === dialableRuntimeHost(requiredHost)
  } catch {
    return false
  }
}

/**
 * Resolve this instance's locally-reachable address from env. A wildcard bind
 * (`0.0.0.0` / `::`) is normalized to loopback so a same-machine caller always
 * gets a usable host — a wildcard is a bind address, not a dial address.
 */
export function resolveRuntimeAddress(env: AppEnv = loadEnv()): RuntimeAddress {
  const host = dialableRuntimeHost(env.HOST)
  return { host, port: env.PORT, baseUrl: dialableRuntimeBaseUrl(host, env.PORT) }
}

/** This instance's absolute inbound-webhook URL (`POST` a message into a session). */
export function resolveWebhookUrl(env?: AppEnv): string {
  return `${resolveRuntimeAddress(env).baseUrl}${WEBHOOK_MESSAGES_PATH}`
}
