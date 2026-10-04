import { isReasoningEffort, type ReasoningEffort } from './reasoning'

export interface ModelReasoningPreference {
  providerId: string
  modelId: string
  effort: ReasoningEffort
}

const MAX_PREFERENCES = 50

function normalizePreference(value: unknown): ModelReasoningPreference | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ModelReasoningPreference>
  if (
    typeof candidate.providerId === 'string' &&
    candidate.providerId.length > 0 &&
    typeof candidate.modelId === 'string' &&
    candidate.modelId.length > 0 &&
    typeof candidate.effort === 'string' &&
    isReasoningEffort(candidate.effort)
  ) {
    return {
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      effort: candidate.effort,
    }
  }
  return null
}

export function modelReasoningFor(
  preferences: readonly ModelReasoningPreference[],
  providerId: string,
  modelId: string,
): ReasoningEffort | undefined {
  return preferences.find(
    (preference) => preference.providerId === providerId && preference.modelId === modelId,
  )?.effort
}

/**
 * Upsert one provider/model preference and move it to the front. Keeping this
 * pure makes the synchronization policy easy to test independently of storage.
 */
export function setModelReasoningInList(
  preferences: readonly ModelReasoningPreference[],
  next: ModelReasoningPreference,
): ModelReasoningPreference[] {
  if (!next.providerId || !next.modelId) return [...preferences]
  return [
    next,
    ...preferences.filter(
      (preference) =>
        preference.providerId !== next.providerId || preference.modelId !== next.modelId,
    ),
  ].slice(0, MAX_PREFERENCES)
}

export function removeModelReasoningFromList(
  preferences: readonly ModelReasoningPreference[],
  providerId: string,
  modelId: string,
): ModelReasoningPreference[] {
  return preferences.filter(
    (preference) => preference.providerId !== providerId || preference.modelId !== modelId,
  )
}

/** Validate the preferences read from the canonical server settings envelope. */
export function normalizeModelReasoningPreferences(raw: unknown): ModelReasoningPreference[] {
  if (!Array.isArray(raw)) return []
  const normalized: ModelReasoningPreference[] = []
  const pairs = new Set<string>()
  for (const value of raw) {
    const preference = normalizePreference(value)
    if (!preference) continue
    const pair = `${preference.providerId}\u0000${preference.modelId}`
    if (pairs.has(pair)) continue
    pairs.add(pair)
    normalized.push(preference)
    if (normalized.length === MAX_PREFERENCES) break
  }
  return normalized
}
