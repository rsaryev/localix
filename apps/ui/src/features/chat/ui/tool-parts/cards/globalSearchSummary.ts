import { asRecord, strField } from './format'

export interface GlobalSearchSummary {
  mode: 'search' | 'read' | 'browse'
  /** The card title: the query, or what is being read. */
  title: string
  /** Settled subtitle; the card shows its own while the call runs. */
  subtitle: string
  /** True when the result says meaning took part in the match. */
  byMeaning: boolean
}

/** Hits in a `global_search` result: the JSON payload's groups, or one line per hit otherwise. */
function countHits(resultText: string): number | null {
  try {
    const payload = JSON.parse(resultText) as { groups?: Array<{ hits?: unknown[] }> }
    if (!Array.isArray(payload.groups)) return null
    return payload.groups.reduce((n, g) => n + (Array.isArray(g.hits) ? g.hits.length : 0), 0)
  } catch {
    return null
  }
}

/** What a `global_search` (or legacy `history_search`) call did, for its transcript card. */
export function globalSearchSummary(
  input: unknown,
  resultText: string | undefined,
): GlobalSearchSummary {
  const record = asRecord(input)
  const query = strField(record, 'query')
  const reading = strField(record, 'around_message_id') ?? strField(record, 'session_id')
  const text = (resultText ?? '').trim()
  if (reading) {
    return {
      mode: 'read',
      title: 'conversation',
      subtitle: text ? 'Read' : 'Nothing to read',
      byMeaning: false,
    }
  }
  if (!query) {
    return {
      mode: 'browse',
      title: 'recent sessions',
      subtitle: text ? 'Listed' : 'None',
      byMeaning: false,
    }
  }
  const hits = countHits(text)
  const byMeaning = text.includes('"matching":"words + meaning')
  const subtitle =
    !text || text.startsWith('No matches')
      ? 'No matches'
      : hits === null
        ? 'Results'
        : `${hits} result${hits === 1 ? '' : 's'}${byMeaning ? ' · by meaning' : ''}`
  return { mode: 'search', title: query, subtitle, byMeaning }
}
