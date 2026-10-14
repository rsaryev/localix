/** Session titles are persisted, rendered throughout the UI, and re-enter prompts for children. */
export const SESSION_TITLE_MAX_CHARS = 200

/**
 * Defensive normalization for trusted internal creators that bypass HTTP schemas.
 * Public ingress rejects oversized titles; internal/generated titles are clipped.
 */
export function normalizeSessionTitle(value: string | undefined, fallback: string): string {
  const clean = value?.replace(/\s+/g, ' ').trim() || fallback
  if (clean.length <= SESSION_TITLE_MAX_CHARS) return clean
  let end = SESSION_TITLE_MAX_CHARS
  const last = clean.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return clean.slice(0, end)
}
