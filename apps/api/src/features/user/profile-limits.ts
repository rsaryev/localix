/**
 * Stable-prefix budgets for persistent user-authored context. These are deliberately
 * generous: ingress rejects only pathological new values, while prompt assembly also
 * clips legacy database rows that predate the limits.
 */
export const USER_PROFILE_PROMPT_MAX_CHARS = 12_000
export const USER_PROFILE_FIELD_MAX_CHARS = USER_PROFILE_PROMPT_MAX_CHARS
export const RESPONSE_DEFAULTS_MAX_CHARS = 8_000
export const UI_SETTINGS_MAX_SERIALIZED_CHARS = 256_000
export const AGENT_SETTINGS_MAX_SERIALIZED_CHARS = 256_000

function clipWithMarker(value: string, maxChars: number, marker: string): string {
  const clean = value.trim()
  if (clean.length <= maxChars) return clean

  const suffix = `\n[... ${marker} truncated at ${maxChars.toLocaleString('en-US')} characters]`
  let end = Math.max(0, maxChars - suffix.length)
  // Do not leave a lone high surrogate at the cut boundary.
  const last = clean.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return clean.slice(0, end) + suffix
}

/** Bound the fully formatted profile section body, including legacy oversized rows. */
export function clipUserProfilePrompt(value: string): string {
  return clipWithMarker(value, USER_PROFILE_PROMPT_MAX_CHARS, 'user profile')
}

/** Bound response-style guidance before it enters the stable cached prompt prefix. */
export function clipResponseDefaultsPrompt(value: string): string {
  return clipWithMarker(value, RESPONSE_DEFAULTS_MAX_CHARS, 'response defaults')
}

/** JSON-size guard for persistent settings envelopes. */
function isWithinSerializedBudget(value: unknown, maxChars: number): boolean {
  try {
    return JSON.stringify(value).length <= maxChars
  } catch {
    return false
  }
}

export function isUiSettingsWithinIngressBudget(value: unknown): boolean {
  return isWithinSerializedBudget(value, UI_SETTINGS_MAX_SERIALIZED_CHARS)
}

export function isAgentSettingsWithinIngressBudget(value: unknown): boolean {
  return isWithinSerializedBudget(value, AGENT_SETTINGS_MAX_SERIALIZED_CHARS)
}
