/**
 * Pure eligibility + adaptive-debounce policy for edit prediction (plan §6). No editor
 * imports — the driver reads live signals and hands them here so every rule is
 * deterministically unit-testable. These gate whether a request is even scheduled;
 * they never mutate the document.
 */

/** Why a prediction was NOT scheduled — user-safe reason codes (no doc text/paths). */
export type EditPredictionIneligibleReason =
  | 'empty'
  | 'read-only'
  | 'composition'
  | 'completion-open'
  | 'bulk-edit'
  | 'oversized-paste'
  | 'backoff'

/** Live signals the driver samples at edit time. */
export interface EditPredictionEligibilitySignals {
  /** The document is empty / whitespace-only. */
  docEmpty: boolean
  /** The editor is read-only. */
  readOnly: boolean
  /** An IME composition is in progress (never interrupt it). */
  composing: boolean
  /** A completion / snippet popup is active (it owns Tab + the caret). */
  completionOpen: boolean
  /** A large programmatic edit (format/refactor/replace-all) just landed. */
  bulkEdit: boolean
  /** A paste larger than the manual-only threshold just landed. */
  oversizedPaste: boolean
  /** The user explicitly asked for a prediction — bypasses the paste guard. */
  manual: boolean
  /** An active error/backoff window is suppressing automatic work. */
  inBackoff: boolean
}

export interface EditPredictionEligibility {
  eligible: boolean
  reason?: EditPredictionIneligibleReason
}

/**
 * Decide whether to schedule a prediction. Order matters: hard blocks (empty,
 * read-only, IME, completion popup, active backoff) come first; the paste guard is
 * waived for a manual trigger. A `manual` request still respects the hard blocks.
 */
export function isEditPredictionEligible(
  s: EditPredictionEligibilitySignals,
): EditPredictionEligibility {
  if (s.docEmpty) return { eligible: false, reason: 'empty' }
  if (s.readOnly) return { eligible: false, reason: 'read-only' }
  if (s.composing) return { eligible: false, reason: 'composition' }
  if (s.completionOpen) return { eligible: false, reason: 'completion-open' }
  if (s.inBackoff) return { eligible: false, reason: 'backoff' }
  if (!s.manual && s.bulkEdit) return { eligible: false, reason: 'bulk-edit' }
  if (!s.manual && s.oversizedPaste) return { eligible: false, reason: 'oversized-paste' }
  return { eligible: true }
}

/** A single change larger than this (and not typing) is treated as a bulk/paste edit. */
export const OVERSIZED_PASTE_CHARS = 400

/**
 * Size classification of one model content change — the two size signals
 * {@link isEditPredictionEligible} consumes.
 *
 * Measured from the INSERTED TEXT, which is the only honest measure. The driver also had an
 * `onDidPaste` handler that estimated the paste from the whole-line lengths of the pasted
 * range (`model.getLineLength(line)` summed over `range.startLineNumber..endLineNumber`), and
 * because Monaco fires `onDidPaste` AFTER applying the edit, that estimate OVERWROTE this
 * accurate one. Pasting five characters into a 500-character line therefore read as a
 * 500-character paste and silently suppressed the prediction. (Monaco's
 * `codeEditorWidget._paste` also fires the event only `if (source === 'keyboard')`, so a
 * context-menu or drag-drop paste never reached it at all — it could not have been the source
 * of truth even if the arithmetic had been right.) The content change sees every paste,
 * keyboard or not, and already knows exactly what was inserted.
 */
export function classifyChangeSize(
  changes: ReadonlyArray<{ text: string }>,
  isFlush: boolean,
): { oversizedPaste: boolean; bulkEdit: boolean } {
  const inserted = changes.reduce((sum, change) => sum + change.text.length, 0)
  return {
    oversizedPaste: inserted > OVERSIZED_PASTE_CHARS,
    // A flush replaces the whole model (reload/format/refactor); size is beside the point.
    bulkEdit: isFlush || inserted > OVERSIZED_PASTE_CHARS * 2,
  }
}

/**
 * There is deliberately NO editor debounce here.
 *
 * A cadence-adaptive `adaptiveDebounceMs` clamped to 350–700 ms (default 500) lived in this
 * module, exported with its `MIN`/`MAX`/`DEFAULT` constants and its own tests, and had NO
 * production caller — the Monaco driver never read it. The real Tab debounce is the provider's
 * `debounceDelayMs: 100` in `monaco/editPrediction.ts`, so anyone tuning Tab latency here was
 * turning a knob 3.5-7x away from the value that runs.
 *
 * Nor is there anything to adopt, which is the part worth recording. In Monaco the delay is
 * `findLastMax(providers.map(p => p.debounceDelayMs)) ?? recommendedDebounceValue`, re-read on
 * EVERY request, so a provider could vary it — but the fallback
 * is not adaptive either: Monaco registers this feature's debounce as
 * `{ min: 50, max: 50 }`, pinning its sliding-window
 * average of observed provider latency to a constant 50 ms. Our 100 ms is the same order of
 * magnitude, chosen once, by the driver that owns the request.
 *
 * The INPUT surfaces are the opposite case and keep their adaptive delay:
 * `useInlineCompletion` owns its own timer, so `shared/lib/adaptiveDebounce` genuinely runs
 * there.
 */

/**
 * There is deliberately NO trigger classifier here any more.
 *
 * A `classifyTrigger(userEvent, manual)` returning typing/paste/undo/redo/manual lived here,
 * documented as feeding "cache keys and telemetry". It fed neither: no production code called
 * it, the wire request carries no trigger (see `NextEditServiceDeps.triggerClass`), and its six
 * tests kept it looking alive. What the trigger genuinely decides IS already implemented above
 * — `isEditPredictionEligible` consumes `manual`, `bulkEdit` and `oversizedPaste` to gate
 * whether a request is scheduled at all.
 *
 * Do not "fix the gap" by threading a trigger into the server's cache key. Our prompt is
 * trigger-independent — it is built from content + cursor + edit history + context — so with an
 * identical fingerprint the model has nothing to differentiate on, and keying by trigger would
 * only fragment the cache. A trigger kind is meaningful only where it is PASSED to
 * the provider and lets an explicit request bypass snoozing and post-undo suppression; even then
 * it is not an equality component but a directed reuse rule (an explicit result
 * may serve an automatic request, never the reverse). Neither condition holds for us.
 */
