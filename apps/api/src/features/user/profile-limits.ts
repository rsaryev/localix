/** Serialized ingress budgets for persistent settings envelopes. */
export const UI_SETTINGS_MAX_SERIALIZED_CHARS = 256_000
export const AGENT_SETTINGS_MAX_SERIALIZED_CHARS = 256_000

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
