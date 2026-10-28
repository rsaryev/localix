import { resumeSession } from './resume-session'
import { MAX_TRANSCRIPT_EVENTS } from '../shared/contracts'
import type { TranscriptSlice, TranscriptEvent } from '../shared/contracts'
import { toolNameOf, toolNamesByCallId } from './transcript/tool-names'
import { isoStamp } from './resource-nodes'

/**
 * Mirrors core's own `@session:` digest (`projects/session-digest.ts`) so an external session reads
 * like a linked Localix one, and lands inside the 3000-char budget `expand-refs` gives kind
 * `resource`. The registry's hard ceiling (RESOURCE_EXPANSION_MAX_BYTES, 64 KiB) is far above this
 * — a digest that needed it would not be a digest.
 */
const DIGEST_MAX_TURNS = 6
const DIGEST_PER_TURN_CHARS = 400
const DIGEST_TARGET_CHARS = 3_000

/**
 * The window this digest reads, from the session's END (`tail: true`).
 *
 * Adapters used to bound a read from the head only, so a session longer than this window showed its
 * MIDDLE while looking like its end. They now take either end for the same cost — `total` already
 * forces a full walk of the source, so stopping early never saved the I/O (adapters/event-window.ts).
 * On a rollout of tens of megabytes, a head read and a tail read cost the same few tens of ms.
 *
 * The window stays bounded because each event is clipped and the digest only prints a handful of
 * turns from it; what it does not show is stated in the range line rather than implied.
 */
export const DIGEST_SCAN_EVENTS = 1_000
export const DIGEST_SCAN_EVENT_CHARS = 600

function turnLine(event: TranscriptEvent, toolNames: ReadonlyMap<string, string>): string {
  const named = toolNameOf(event, toolNames)
  const role = event.role === 'tool' && named ? `tool:${named}` : event.role
  const text = event.text.replace(/\s+/g, ' ').trim()
  const clipped =
    text.length > DIGEST_PER_TURN_CHARS
      ? `${text.slice(0, DIGEST_PER_TURN_CHARS).trimEnd()}…`
      : text
  return `[${role}] ${clipped}`
}

/**
 * The COMPACT digest an expanded ref inserts: provenance, a bounded tail of turns, and the sentence
 * that tells the model how to read the rest. It never inlines a transcript — the point of the ref
 * is that the model can decide whether the full read is worth its budget.
 */
export function digest(slice: TranscriptSlice): string {
  const { summary, events, total, key } = slice
  // Not every provider records a start; the first timestamped event is the next best evidence, and
  // when there is neither the line says so rather than passing the end off as a range.
  const startedAt = summary.startedAt ?? events.find((e) => e.timestamp)?.timestamp
  const header = [
    `## ${summary.provider} — ${summary.title.trim() || summary.nativeSessionId}`,
    `key: ${key}`,
    [summary.cwd ? `cwd: ${summary.cwd}` : null, `source: ${summary.sourcePath}`]
      .filter((part): part is string => part !== null)
      .join('    '),
    ...(resumeSession(summary)
      ? [
          `To open this session for the user: ExternalAgentSessions { action: "resume", key: "${key}" }, then execute the returned command with \`Bash\` action:"open". Reading its transcript does not open a terminal.`,
        ]
      : []),
    `range: ${startedAt === undefined ? '(start unknown)' : isoStamp(startedAt)} → ${isoStamp(summary.updatedAt)}    events: ${total}`,
  ]
  /**
   * "Full transcript" was an overclaim for exactly the sessions this digest matters most for. One
   * `transcript` read returns at most `MAX_TRANSCRIPT_EVENTS`, so on the largest session here — 8,753
   * events — it answers with 2,000 of them and the pointer promised the rest. A session that fits says
   * "full"; one that does not names the walk instead, which is the same correction already made to the
   * transcript answer and the import note.
   */
  const oneRead = total <= MAX_TRANSCRIPT_EVENTS
  const reach = oneRead
    ? `Full transcript: ExternalAgentSessions { action: "transcript", key: "${key}" }`
    : `This session is ${total} events — more than one read returns. Walk it with ExternalAgentSessions { action: "transcript", key: "${key}", from: 0 }, raising "from" by the events returned; "tail: true" reads the end`
  const footer = `(Compact digest of an external ${summary.provider} session. ${reach}. Several sessions at once: { action: "context", keys: [...] }. Live state: { action: "explain", key: "${key}" }.)`

  if (events.length === 0) {
    return [...header, '', '(No readable turns in this transcript.)', '', footer].join('\n')
  }

  // Walk backwards from the newest turn: the tail is what a reader wants, and spending the budget
  // newest-first means an oversized early turn can never crowd out the recent ones.
  // Built from the whole window, so a shown result can be named by a call that was read but
  // not shown — see `toolNamesByCallId`.
  const toolNames = toolNamesByCallId(events)
  const budget = DIGEST_TARGET_CHARS - header.join('\n').length - footer.length
  const lines: string[] = []
  let used = 0
  let firstShown = events.length - 1
  for (let index = events.length - 1; index >= 0 && lines.length < DIGEST_MAX_TURNS; index -= 1) {
    const line = turnLine(events[index], toolNames)
    if (used + line.length > budget && lines.length > 0) break
    lines.push(line)
    used += line.length + 1
    firstShown = index
  }
  lines.reverse()

  /**
   * A 1-based range over the WHOLE session, read from each event's own `ordinal` rather than from
   * its index here — the window holds the session's END, so an index into it is not a position in
   * the conversation.
   *
   * This used to read from the head, which meant a session longer than the scan window showed its
   * MIDDLE while looking like its end, and it stated the gap as two numbers for a reader to
   * subtract. Both are gone: the digest now genuinely ends where the session does, and what it
   * omits — the earlier turns — is said in words and is reachable, because `transcript` reads from
   * the start. Every other bounded surface here does the same (the roster's "Showing 50 of 104",
   * the tool's "399 not shown"), and this is the one whose reader is a model.
   */
  const from = (events[firstShown]?.ordinal ?? 0) + 1
  const to = (events[events.length - 1]?.ordinal ?? 0) + 1
  const earlier = from - 1
  const range =
    earlier === 0
      ? `turns ${from}–${to} of ${total}:`
      : `turns ${from}–${to} of ${total} — the session's most recent; the ${earlier} earlier turns are not shown:`
  return [...header, '', range, ...lines, '', footer].join('\n')
}
