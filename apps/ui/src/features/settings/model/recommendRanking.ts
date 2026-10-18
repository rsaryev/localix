import type { LocalModelEntry } from '@/shared/api/localModelsApi'

/**
 * Where on the speed-to-quality scale the person stands. Balanced is the default: the best
 * model that leaves this computer room for everything else. Further right trades speed and
 * headroom for a larger model.
 */
export const BALANCE_STOPS = [
  { label: 'Fastest', value: 0.05 },
  { label: 'Faster', value: 0.25 },
  { label: 'Balanced', value: 0.5 },
  { label: 'Smarter', value: 0.75 },
  { label: 'Smartest', value: 0.95 },
] as const
export const DEFAULT_BALANCE = 2
/** Choices listed under the slider. */
export const RECOMMENDED_SHOWN = 3

/**
 * A model that fits only tightly (more than 60% of the memory for models) is worth less the
 * more the person values speed: at Balanced it loses to a comfortable fit, at Smartest it
 * barely matters.
 */
const TIGHT_FIT_BASE = 0.45

/** How well a choice suits preference `p` (0 fastest, 1 smartest). Memory is already a filter. */
export function utility(entry: LocalModelEntry, p: number): number {
  const s = entry.scores
  if (!s) return 0
  const tight = entry.plan?.fit === 'tight' ? TIGHT_FIT_BASE ** (1 - p) : 1
  return s.intelligence ** (0.9 * p) * s.speed ** (0.9 * (1 - p)) * s.fidelity ** 0.3 * tight
}

/** The best choices for `p`, one per model (the best width of each), best first. */
export function rankRecommended(
  entries: readonly LocalModelEntry[],
  p: number,
  limit = RECOMMENDED_SHOWN,
): LocalModelEntry[] {
  const seen = new Set<string>()
  return entries
    .filter((e) => e.scores)
    .map((entry, index) => ({ entry, index, score: utility(entry, p) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter(({ entry }) => {
      const key = entry.spec.label.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map(({ entry }) => entry)
}
