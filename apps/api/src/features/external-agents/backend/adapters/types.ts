/**
 * The provider adapter surface.
 *
 * The rule this shape exists to enforce: **adding a provider is adding one descriptor file plus
 * one registry entry — never editing a switch statement.** Everything provider-specific (roots,
 * enumeration, parsing, resume command, detection manifest) is a property of the descriptor, so
 * the discovery/roster/context layers stay provider-agnostic.
 *
 * The split into three calls is a performance contract, not a stylistic one:
 *
 *   listSources()   MUST be cheap — stat/readdir or one indexed query. It runs on every scan.
 *   readSummaries() parses, and is only ever called for entries the index cache missed.
 *   readTranscript() parses a single session's body, and is only called on demand.
 *
 * Collapsing these would mean re-parsing every transcript to paint a list, which at real history
 * volumes (hundreds of files per provider) is the difference between a list that opens and one
 * that hangs.
 *
 * Adapters supply provider id + source format, stable source identity and cursor, session/event
 * ids, role/timestamp/text, touched files, source path for citations, and clear errors — and they
 * must be read-only with respect to provider-owned files. We never write to a provider's
 * directory; every open is a read.
 */

import type { SessionSummary, TranscriptEvent, ProviderId } from '../../shared/contracts'
import type { TurnState } from '../live/turn-state'

/** A candidate session located on disk, before anything has been parsed out of it. */
export interface SourceRef {
  readonly nativeSessionId: string
  /** Absolute path of the file, or of the database, this session lives in. */
  readonly sourcePath: string
  /**
   * Cache key input. For a file: mtime+size. For a row in a database: the row's own updated-at.
   * Whatever it is, it MUST change when the session's content changes — this is the "real signal"
   * the index invalidates on, instead of re-parsing on every render.
   */
  readonly revision: string
  /** File size captured with the revision, used to keep optional full-history metrics bounded. */
  readonly sourceBytes?: number
  /** Cheap hints available without opening the file (e.g. cwd decoded from a directory name). */
  readonly cwdHint?: string
  readonly updatedAtHint?: number
  /** Native parent session id, when enumeration can derive it from the path without a read. */
  readonly parentHint?: string
}

/**
 * Where an append-only summary fold stopped: the byte offset after its last whole record, a mark
 * of the bytes before it, and whatever the format's fold has to carry across the cut.
 */
export interface SummaryFold {
  readonly offset: number
  readonly mark: string
  readonly carry?: Readonly<Record<string, unknown>>
}

export interface FoldedSummary {
  readonly summary: SessionSummary
  readonly fold?: SummaryFold
}

export interface AdapterEnv {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homeDir: string
}

export interface RootProbe {
  readonly path: string
  readonly exists: boolean
}

export interface TranscriptRequest {
  readonly ref: SourceRef
  /** Hard cap on returned events. The adapter MUST report `total` so the caller can say what it withheld. */
  readonly maxEvents: number
  /** Cap on a single event's text; the adapter clips and marks, never drops silently. */
  readonly maxCharsPerEvent: number
  /**
   * Keep the LAST `maxEvents` rather than the first.
   *
   * Free, because `total` already forces a full walk of the source — see `event-window.ts`. Off by
   * default so a caller that wants the opening of a session (what was it asked to do) still gets
   * it; a digest, which wants the recent work, asks for the tail.
   */
  readonly tail?: boolean
  /**
   * Start the window at this ordinal instead of at the session's start.
   *
   * Head and tail together still leave a hole: in a long history some sessions exceed the
   * 2,000-event cap, and their middles sit beyond both a head and a tail read of their own session.
   * Positions are the ones every surface already reports, so this is addressable from what a reader
   * was already shown.
   */
  readonly from?: number
}

export interface TranscriptResult {
  readonly events: readonly TranscriptEvent[]
  readonly total: number
  /** The adapter's byte cap stopped the read before the file ended — see `TranscriptSlice`. */
  readonly sourceTruncated?: boolean
}

export interface ProviderAdapter {
  readonly id: ProviderId
  /** Basic interactive launch command; availability is checked on the user's PATH. */
  readonly command: string
  readonly displayName: string
  /**
   * A stable token naming the on-disk format of this provider's history, so a claim about what the
   * adapter parses is checkable against the format it names.
   */
  readonly sourceFormat: string
  /**
   * Honest flag: did the author run this adapter against real history on a real machine?
   * Surfaced in the UI and in `ProviderStatus.verified`. An adapter written from documentation
   * alone ships as `false` rather than pretending.
   */
  readonly verified: boolean
  /**
   * Detection-manifest id for the live-state evaluator. Absent means this provider has no screen
   * manifest, so a live terminal running it resolves to `unknown` rather than a guess.
   */
  readonly detectionManifestId?: string
  /** Shell command continuing this exact native session, with the id quoted as one argument. */
  readonly resumeCommand?: (nativeSessionId: string) => string

  /** Roots this adapter will probe on this machine, in precedence order, with existence. */
  probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]>
  /** Cheap enumeration. Must not parse transcript bodies. */
  listSources(env: AdapterEnv): Promise<readonly SourceRef[]>
  /** Parse summaries for the given refs only (index-cache misses). */
  readSummaries(refs: readonly SourceRef[], env: AdapterEnv): Promise<readonly SessionSummary[]>
  /**
   * Summarize one session, continuing from `previous` when the source only grew since it was read.
   *
   * Optional, for append-only logs. Their token usage is a walk of the whole file, and a live
   * session is appended to every few seconds, so without a resume point every append re-read a file
   * that runs to tens of megabytes. The index prefers this over `readSummaries` when present.
   */
  foldSummary?(
    ref: SourceRef,
    previous: FoldedSummary | undefined,
    env: AdapterEnv,
  ): Promise<FoldedSummary>
  /** Parse one session's body, bounded. */
  readTranscript(req: TranscriptRequest, env: AdapterEnv): Promise<TranscriptResult>
  /**
   * Is this session mid-turn, as its own storage records it?
   *
   * The live half asks this where the screen manifest degraded to its idle guess. It belongs to the
   * ADAPTER because the answer is a property of the format, and the formats do not agree on where
   * it lives: three keep append-only logs whose last record says it (claude-code, codex, copilot),
   * Hermes writes `ended_at` and an `end_reason` on the session row, and opencode and Gemini CLI
   * keep neither an append-only log nor an end marker.
   *
   * Optional for exactly that reason. Absent means "this format cannot answer", and the caller
   * keeps the manifest's degraded state WITH its stated reason rather than inventing one.
   * `turn-coverage.test.ts` requires every adapter to either implement this or be listed there with
   * why, so a new provider cannot join by silently declining.
   */
  readTurnState?(ref: SourceRef, env: AdapterEnv, now: number): Promise<TurnState | undefined>
}
