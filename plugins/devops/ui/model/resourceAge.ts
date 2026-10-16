/**
 * Provider-neutral age formatting for resource rows and detail headers.
 *
 * Lives in the shared `ui/model` layer, not under a provider: a container's
 * `Created` and a pod's age answer the same question and must read identically.
 * Compact by design (`45s` / `12m` / `3h` / `9d`) — a list column has room for
 * one token.
 */
export function formatResourceAge(createdAt: string, now: number = Date.now()): string {
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return ''
  const secs = Math.max(0, Math.floor((now - t) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
