/**
 * Negotiate which Docker API version to speak, and what that version can do.
 *
 * The daemon is older or newer than us far more often than not — a Debian host on
 * Docker 20.10, a colima VM, a five-year-old CI runner — and every request path carries the
 * version (`/v1.44/containers/json`). Guessing it produces a 400 with a "client version is
 * too new" body on exactly the machines a developer cannot easily upgrade.
 *
 * The algorithm is moby's `negotiateAPIVersion` (`client/client.go`): start from our maximum,
 * downgrade to the daemon's if it is lower, refuse if it is below our minimum. Version
 * comparison is moby's `compare` (`client/pkg/versions/compare.go`) — per-component integer,
 * NOT lexical, because lexically "1.9" sorts above "1.10".
 *
 * Pure: the caller does the `/version` request and hands the two strings in.
 */

/**
 * The newest version whose request/response shapes this mini app is written against.
 *
 * Deliberately below moby's current 1.55: claiming a version we have not shaped requests for
 * buys nothing, and a lower negotiated version is understood by every newer daemon.
 */
export const MAX_API_VERSION = '1.44'

/**
 * The oldest we will speak natively. moby's own client floor, for the same reason: below it
 * the response shapes diverge enough that a shared parser stops being honest.
 *
 * An older daemon is NOT an error here — the caller falls back to the `docker` CLI, which
 * still supports it. That is the difference from moby, which hard-errors.
 */
export const MIN_API_VERSION = '1.40'

/**
 * `one-shot=true` on the stats endpoint is honoured from 1.41.
 *
 * Established by asking a real daemon rather than by reading a changelog: at v1.40 the
 * parameter is silently IGNORED and the daemon does its two-cycle wait (1201ms, with
 * `precpu_stats` populated); at v1.41 it answers in 7ms with `precpu_stats` zeroed.
 */
export const ONE_SHOT_STATS_VERSION = '1.41'

/** moby's per-component integer comparison: -1, 0 or 1. */
export function compareApiVersions(left: string, right: string): -1 | 0 | 1 {
  if (left === right) return 0
  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    // A missing component counts as 0, so "1.44" and "1.44.0" compare equal.
    const a = Number.parseInt(leftParts[index] ?? '0', 10) || 0
    const b = Number.parseInt(rightParts[index] ?? '0', 10) || 0
    if (a > b) return 1
    if (b > a) return -1
  }
  return 0
}

/** What the daemon told us about itself in `GET /version`. */
export interface DaemonVersionInfo {
  /** The newest version the daemon serves. */
  apiVersion?: unknown
  /** The oldest the daemon will accept; it rejects anything below with a 400. */
  minApiVersion?: unknown
  /** `linux` or `windows` — decides which CPU formula applies to its containers. */
  os?: unknown
}

export interface NegotiatedApi {
  /** The version to put in every request path, e.g. `1.44`. */
  version: string
  /** Whether `one-shot=true` will actually be honoured. */
  oneShotStats: boolean
  /** Windows containers need different stats formulas and have no `top`. */
  windows: boolean
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Choose the version to speak, or `null` when this daemon is outside our range.
 *
 * `null` means "use the CLI", not "fail": it happens when the daemon is older than our floor,
 * or when it refuses everything we can offer (its own `MinAPIVersion` is above our maximum,
 * which is what a much newer daemon that dropped old versions looks like).
 */
export function negotiateApiVersion(info: DaemonVersionInfo): NegotiatedApi | null {
  const daemonVersion = text(info.apiVersion)
  if (!daemonVersion) return null
  if (compareApiVersions(daemonVersion, MIN_API_VERSION) < 0) return null

  // Start at our maximum and come down to the daemon's, exactly as moby does.
  let version = MAX_API_VERSION
  if (compareApiVersions(daemonVersion, version) < 0) version = daemonVersion

  // The daemon's own floor is authoritative: it answers 400 below it.
  const daemonMinimum = text(info.minApiVersion)
  if (daemonMinimum && compareApiVersions(version, daemonMinimum) < 0) {
    if (compareApiVersions(daemonMinimum, MAX_API_VERSION) > 0) return null
    version = daemonMinimum
  }

  return {
    version,
    oneShotStats: compareApiVersions(version, ONE_SHOT_STATS_VERSION) >= 0,
    windows: text(info.os).toLowerCase() === 'windows',
  }
}
