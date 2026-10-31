/**
 * Canonical edit-prediction domain contracts and tunable constants.
 *
 * SAME-FILE ONLY. A prediction is a small diff — up to `MAX_EDITS` contiguous
 * line-range replacements in the CURRENT file — reasoned over the current file, the
 * cursor, this file's recent edit history and policy-shaped Context Fabric output.
 */

import type { AuxLanguageModelDeps } from '../autocomplete/resolve-model'
import type { ContextContribution } from '@localixai/mini-app-sdk/backend'
import type { CompletionReference } from '../inline-completion/contracts'
import type {
  ContextCollectionResult,
  ContextDropReason,
  ContextManager,
} from '../context-fabric/manager'
import type { EditPredictionModelAdapter } from './model/contracts'
import type { EditPredictionResultCache } from './cache/contracts'
import type { Usage } from '@localixai/agent'
import type { LanguageModel } from '@localixai/agent/runtime'

/** A proposed single line-range replacement (1-based inclusive line numbers). */
export interface EditPrediction {
  startLine: number
  endLine: number
  /** The file's exact current text across [startLine, endLine] (drift baseline). */
  original: string
  /** The proposed replacement for that range. */
  replacement: string
}

/** Public, provider-neutral completion status for the realtime RPC. `edits` is present
 * only when the model yielded a validated prediction; all other outcomes are safe
 * neutral results rather than transport failures. */
export type NextEditResult = {
  outcome: NextEditOutcome['outcome']
  edits: EditPrediction[] | null
}

/** The request the editor sends over the realtime socket. */
export interface PredictNextEditRequest {
  /** Correlation metadata required by the only supported wire protocol. */
  requestId: string
  sessionId: string
  filepath: string
  /** Full current text of the open file. */
  content: string
  documentVersion: number
  documentDigest: string
  contextFingerprint?: string
  /** 1-based cursor line — the anchor the prediction reasons around. */
  cursorLine: number
  /** 0-based cursor column — pins the caret within the line so "complete the line
   *  at the cursor" is precise. */
  cursorColumn?: number
  language: string
  /**
   * Same-file recently-edited line windows (the "edit history" / events signal).
   * `before`/`startLine`/`endLine` are OPTIONAL metadata: `before` enables a
   * before→after diff, while the line fields say WHERE each edit happened. When
   * omitted, the event renders as the resulting window without a location.
   */
  recentlyEditedRanges: {
    before?: string[]
    lines: string[]
    startLine?: number
    endLine?: number
  }[]
  /** Client-selected references (the working set plus editor anchors). The server mints
   * trusted scope and resolves them through Context Fabric (`completion-references.ts`). */
  contextReferences?: CompletionReference[]
}

export interface NextEditServiceDeps extends AuxLanguageModelDeps {
  contextManager?: ContextManager
  /** Server-side effective workspace lookup. Never derive this trusted boundary
   * from a model request filepath or an opaque client reference. */
  resolveContextWorkspace?: (
    userId: string,
    sessionId: string,
  ) => Promise<
    | {
        rootPath: string
        isolationId?: string
        excludedRelativePaths?: string[]
      }
    | undefined
  >
  /** Host-owned total request budget. This is independent of provider-specific timeouts. */
  deadlineMs?: number
  /**
   * Optional L1 backend result cache + single-flight. When present the
   * engine looks it up before the (billable) model call and de-dupes identical
   * concurrent fingerprints; when absent the engine computes directly.
   */
  resultCache?: EditPredictionResultCache
  /**
   * Injectable trigger classification for the cache key (typing/paste/undo/redo/
   * manual). The wire request carries no trigger today, so this defaults to `typing`.
   */
  triggerClass?: string
  /**
   * Capability-aware model-adapter factory. Given the resolved provider + model it
   * returns the narrow {@link EditPredictionModelAdapter} the engine drives. Defaults
   * to {@link createLanguageModelAdapter} (the plain `@localixai/agent` provider wrap);
   * a test or a future capability-negotiating resolver can inject its own.
   */
  createModelAdapter?: (model: LanguageModel, modelId: string) => EditPredictionModelAdapter
  /** Metadata-only baseline telemetry. Never receives source text, prompt text,
   * resource URI, or provider response content. */
  recordOutcome?: (event: NextEditOutcome) => void
  recordUsage?: (e: {
    userId: string
    sessionId: string
    modelId: string
    providerConnectionId?: string | null
    providerId?: string | null
    usage: Usage | undefined
  }) => void
}

export type NextEditOutcome = {
  userId: string
  sessionId: string
  outcome: 'predicted' | 'empty' | 'cancelled' | 'deadline_exceeded' | 'no_model' | 'provider_error'
  durationMs: number
  contextReferenceCount: number
  editCount: number
  /**
   * Hunks the reversal guard dropped because they restored text the user had just
   * changed (see `reversal.ts`). A count only — no line numbers, no content.
   *
   * Without it the guard is unfalsifiable: a prediction it silences looks exactly like a
   * model that produced nothing, so neither its value nor an over-eager rule could ever
   * be told from the outside. A rising count with `outcome: 'empty'` means the guard is
   * the reason the user sees no suggestion, which is the case worth reviewing.
   */
  reversedEditCount?: number
  /**
   * Hunks the parser refused, tallied by the rule that refused each one (schema,
   * non_integer_line, out_of_range, no_op). Counts only — no lines, no content.
   *
   * `out_of_range` and `no_op` are mislocation symptoms: the model knew what to write but
   * not where. Their rate is the number any change to how the request conveys the cursor
   * has to move, and without it such a change cannot be judged at all — a reply whose
   * only hunk was mislocated looks exactly like a model that produced nothing.
   */
  editRejections?: Partial<Record<'schema' | 'non_integer_line' | 'out_of_range' | 'no_op', number>>
  /**
   * Hunks whose `replacement` echoed prompt scaffolding — the inline cursor marker or the
   * leading line numbers — and had it stripped before being accepted. A count only.
   *
   * Marking the caret in the text is what created this failure mode, so shipping it without
   * a number for it would make its cost unobservable: a stripped hunk looks exactly like a
   * clean one. A rising count means the prompt needs to say it more plainly, not that the
   * stripper should work harder.
   */
  scaffoldEchoes?: number
  /** Aggregated Context Fabric diagnostics only. Never includes a provider id,
   * contribution id/content, URI, path, label or resolver error. */
  context?: {
    providerCount: number
    contributionCount: number
    droppedByReason: Partial<Record<ContextDropReason, number>>
    outcomesByStatus: Partial<
      Record<ContextCollectionResult['providerOutcomes'][number]['status'], number>
    >
  }
}

/**
 * Inline caret marker written into the prompt's copy of the cursor line, and therefore the
 * one token the model must never echo back inside a `replacement`. Lives here rather than in
 * the prompt module because BOTH sides need it: the prompt writes it, validation strips it.
 *
 * The literal is a widely-used caret sentinel on purpose — a token already present in
 * provider training data beats one we invent.
 */
export const CURSOR_MARKER = '<|cursor|>'

/** Max output tokens for the aux completion — a "next edit" is a small diff. */
export const MAX_TOKENS = 1024
/** End-to-end host budget, covering Context Fabric and model completion. */
export const NEXT_EDIT_DEADLINE_MS = 8_000
/** Hard cap on hunks per prediction — a "next edit" is a small, confident diff. */
export const MAX_EDITS = 4
/**
 * When the file exceeds this many lines, the PROMPT shows only a window around the
 * cursor (with real 1-based line numbers) instead of the whole file — the model
 * can't reason usefully over thousands of lines and it is needless spend. Validation
 * still runs against the FULL file, so a windowed prompt never widens what's valid.
 */
export const PROMPT_WINDOW_LINES = 1200
/** Lines of context kept on each side of the cursor when windowing a large file. */
export const PROMPT_WINDOW_RADIUS = 600
/** Per-context-snippet character cap so one big block can't dominate the prompt. */
/**
 * Byte ceiling on the numbered file window in the prompt — the term that dominates a
 * prediction's cost and its time-to-first-token, and the only one that was unbounded.
 *
 * `PROMPT_WINDOW_LINES`/`PROMPT_WINDOW_RADIUS` bound the window in LINES, which says nothing
 * about size. Measured: 1200 lines of ordinary code renders ~54 KiB, but 1200 lines of a
 * 12-field object literal per line — generated code, i18n tables, JSX with long class strings,
 * anything minified — renders **358 KiB**, roughly 90k tokens, sent on EVERY keystroke-triggered
 * prediction. Line-windowing does not help: 20k such lines still render 382 KiB. The driver's
 * 500 KB document gate does not catch it either, since it measures the document, not the prompt.
 *
 * 64 KiB is chosen to leave the common case exactly as it was (ordinary code at the full 1200-line
 * window is ~54 KiB) and clamp only the pathological tail. A tiny window (a handful of lines
 * around the cursor) is only affordable for a design that asks the model to REWRITE that
 * window; our reply addresses absolute line numbers anywhere in the file and therefore has
 * to show them.
 */
export const PROMPT_WINDOW_BYTE_CEILING = 64 * 1024

export const MAX_CONTEXT_CHARS = 1500
/** Total character budget for the caller-supplied context blocks. */
export const CONTEXT_CHAR_BUDGET = 8000
/** Max ranked context windows kept after packing. */
export const MAX_CONTEXT_WINDOWS = 8

export type { ContextContribution }
