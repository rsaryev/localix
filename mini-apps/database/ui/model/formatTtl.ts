/**
 * Compact human TTL for the Redis keyspace tree — seconds → the largest sensible unit
 * (`45s` / `12m` / `3h` / `2d`). Sub-second / non-positive values render as `0s`. Pure.
 */
export function formatTtl(seconds: number): string {
  const s = Math.floor(seconds)
  if (s <= 0) return '0s'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
