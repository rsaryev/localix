import { MAX_TRANSCRIPT_EVENTS } from '../shared/contracts'
import type { SessionSummary, TranscriptSlice } from '../shared/contracts'
import type { SourceRef, TranscriptRequest, TranscriptResult } from './adapters/types'

const DEFAULT_MAX_EVENTS = 400
const DEFAULT_MAX_EVENT_CHARS = 4_000

export function transcriptEventLimit(maxEvents?: number): number {
  return Math.min(Math.max(1, maxEvents ?? DEFAULT_MAX_EVENTS), MAX_TRANSCRIPT_EVENTS)
}

export function transcriptRequest(
  ref: SourceRef,
  limit: number,
  maxCharsPerEvent?: number,
  tail?: boolean,
  from?: number,
): TranscriptRequest {
  return {
    ref,
    maxEvents: limit,
    maxCharsPerEvent: maxCharsPerEvent ?? DEFAULT_MAX_EVENT_CHARS,
    ...(tail ? { tail: true } : {}),
    ...(from ? { from } : {}),
  }
}

export function transcriptSlice(
  key: string,
  summary: SessionSummary,
  result: TranscriptResult,
  tail?: boolean,
): TranscriptSlice {
  return {
    key,
    summary,
    events: result.events,
    withheld: Math.max(0, result.total - result.events.length),
    total: result.total,
    ...(result.sourceTruncated ? { sourceTruncated: true } : {}),
    // Recorded here rather than in six adapters: this is the request that produced the slice, and
    // every adapter honours it through `eventWindow`.
    readFrom: tail === true ? 'tail' : 'head',
  }
}

export function uniqueContextKeys(keys: readonly string[]): string[] {
  // ONE section per session, however many times it was named.
  //
  // A repeated key used to be read again, rendered again, and charged against the budget again:
  // measured on a real session, passing one key three times produced three identical sections and
  // 10,665 characters where 3,435 were warranted. Assembling `keys` from two places is the
  // ordinary way that happens, and the cost falls on the OTHER sessions, whose fair share shrinks
  // to pay for a copy. The FIRST occurrence is the one kept; where its section then lands is
  // `compose`'s business, which orders by recency and breaks ties on the key so the text a model
  // sees is stable across calls.
  const seen = new Set<string>()
  return keys.filter((key) => (seen.has(key) ? false : (seen.add(key), true)))
}
