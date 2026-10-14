/** Small URL helpers, shared so callers don't each re-implement `new URL(...)`. */

/** Origin (`scheme://host:port`); falls back to the raw string if unparseable. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** Host (`host:port`) for compact labels; falls back to the raw string. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
