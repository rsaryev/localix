/**
 * THE COMPLETION CONTRACT — what a mini app field or editor asks the host's model for, and what
 * comes back: ghost text for a text input, edit predictions for a code editor, and the references
 * that ground both.
 *
 * Split from `runtime-payloads.ts`, which held these beside the workspace, session and file
 * payloads. They change for a different reason: a completion shape moves with the host's one
 * shared model call (its caching, staleness and diagnostics), while an open-file or session shape
 * moves with the workbench. In one file, a completion change was reviewed against payloads it
 * never touches.
 *
 * `runtime-payloads.ts` re-exports all of this, so `@localixai/mini-app-sdk/ui/runtime` is unchanged.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Something a completion should know about, named the way a message binding's target names it.
 * A mini app editor passes its own anchors (a statement's tables); the host adds what is open on
 * screen and resolves everything server-side, so a mini app never sends content it read itself.
 */
export interface MiniAppCompletionReference {
  kind: string
  token: string
  label: string
  uri?: string
  attributes?: Record<string, string | number | boolean>
  origin?: 'linked' | 'ambient'
}

/**
 * Ghost-text completion for a text field a mini app owns. The mini app names its backend surface
 * (`<app>.<field>`, declared on its `BackendSubsystem`) and passes the field's live state; the
 * host owns the debounce, the one shared model call, caching, stale-reply protection, retries and
 * Tab/Escape — and attaches what the user has open, so the field is grounded without mini app code.
 */
export interface MiniAppTextInputCompletionInput<TPayload = unknown> {
  surface: string
  sessionId: string | null
  value: string
  setValue: (value: string) => void
  /** Whatever the surface's backend validates; `draft` is the conventional field. */
  payload: TPayload
  /** Changes whenever the server-side grounding may have changed (a new change set, a new row). */
  contextKey: string
  /** The route switch — usually `useMiniAppEditPredictionEnabled()`. */
  enabled: boolean
  /** Field-specific gate: not submitting, no menu open, draft still eligible. */
  active: boolean
  focused: boolean
  caretAtEnd: boolean
}

export interface MiniAppTextInputCompletion {
  /** Append-only ghost text, including any required joining whitespace. */
  suggestion: string
  accept: (unit?: 'all' | 'word' | 'line') => boolean
  dismiss: () => boolean
  request: () => boolean
  /** Tab accepts, Escape dismisses, Alt+\ asks again. True means the event was consumed. */
  handleKeyDown: (event: ReactKeyboardEvent) => boolean
  handleCompositionStart: () => void
  handleCompositionEnd: () => void
}

export interface MiniAppEditPredictionRequest {
  file: string
  content: string
  cursorLine: number
  cursorColumn?: number
  requestId: string
  documentVersion: number
  documentDigest: string
  contextFingerprint?: string
  language: string
  recentlyEditedRanges: Array<{
    before?: string[]
    lines: string[]
    startLine?: number
    endLine?: number
  }>
  /** The editor's anchors. The host appends the shared working set before sending. */
  contextReferences?: MiniAppCompletionReference[]
}

export interface MiniAppEditPrediction {
  startLine: number
  endLine: number
  original: string
  replacement: string
}

export type MiniAppEditPredictionResult =
  | { outcome: 'predicted'; edits: MiniAppEditPrediction[] }
  | {
      outcome: 'empty' | 'stale_delivery'
      edits: null
      diagnostic?:
        | { code: 'stale_delivery'; mismatch: string }
        | {
            code: 'empty'
            outcome: 'empty' | 'cancelled' | 'deadline_exceeded' | 'no_model' | 'provider_error'
          }
    }
