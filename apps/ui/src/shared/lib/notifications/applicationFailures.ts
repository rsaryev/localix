import { recordClientFact } from './clientFacts'
import { addEventTraceStep, correlatedFailureOrigin } from './trace'
import type { TraceAttributeValue } from './types'
import type { UnreportedFailure } from './incidentFallback'

let failureSequence = 0

const BENIGN_WINDOW_DIAGNOSTICS = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
])

export interface ApplicationFailureContext {
  surface: string
  kind?: 'render' | 'route' | 'window' | 'promise'
}

const APPLICATION_ORIGIN = { kind: 'application' } as const

function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    if (typeof value.message === 'string') return value.message
    if (typeof value.status === 'number') {
      return `${value.status}${typeof value.statusText === 'string' ? ` ${value.statusText}` : ''}`
    }
  }
  return 'Unknown application error'
}

/**
 * Browser layout scheduling diagnostics arrive through `window.error`, but do
 * not represent an uncaught application exception. Keep the allowlist exact so
 * a real ResizeObserver callback failure is still journaled.
 */
export function isBenignWindowDiagnostic(error: unknown): boolean {
  return BENIGN_WINDOW_DIAGNOSTICS.has(failureMessage(error).trim())
}

/**
 * Monaco's standalone resolver rejects with this exact error when an editor
 * command finishes after its text model was disposed. It is a cancellation
 * race, not an application or AI-model failure. Match the resolver frame and
 * Monaco-owned chunk as well as the message so an unrelated "Model not found"
 * remains visible.
 */
export function isDisposedMonacoModelReference(error: unknown): boolean {
  if (!(error instanceof Error) || error.message.trim() !== 'Model not found') return false
  const stack = error.stack ?? ''
  return (
    stack.includes('createModelReference') &&
    /(?:monaco-editor|standaloneServices|editor\.api(?:[-.][\w-]+)?\.js)/u.test(stack)
  )
}

function isBenignApplicationFailure(error: unknown, context: ApplicationFailureContext): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  if (context.kind === 'window' && isBenignWindowDiagnostic(error)) return true
  return context.kind === 'promise' && isDisposedMonacoModelReference(error)
}

function failureAttributes(
  error: unknown,
  context: ApplicationFailureContext,
): Record<string, TraceAttributeValue> {
  const attributes: Record<string, TraceAttributeValue> = {
    surface: context.surface.slice(0, 160),
    failureKind: context.kind ?? 'window',
  }
  if (error instanceof Error) attributes.errorType = error.name.slice(0, 80)
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    if (typeof value.code === 'string' || typeof value.code === 'number') {
      attributes.code = value.code
    }
    if (typeof value.status === 'string' || typeof value.status === 'number') {
      attributes.status = value.status
    }
  }
  return attributes
}

/**
 * The headline of a crash row, in the person's words.
 *
 * It was `${surface} failed` — "Background operation failed", "Route failed", "Application shell
 * failed" — the boundary's internal name with a verb glued on, which reads like a log line and says
 * nothing about what stopped. The trace keeps that summary as a diagnostic; the headline says what
 * the person lost. A render boundary's surface is already a noun phrase written for people ("This
 * message", "The k8s background"), so it is kept; the app-level ones are named for what they are.
 */
export function applicationFailureTitle(context: ApplicationFailureContext): string {
  switch (context.kind ?? 'window') {
    case 'render':
      return context.surface === 'Application shell'
        ? 'The window could not render'
        : `${context.surface} could not render`
    case 'route':
      return 'This view could not open'
    case 'promise':
      return 'A background task stopped unexpectedly'
    case 'window':
      return 'Something went wrong in Localix'
  }
}

/** Central application failure ingress used by global and React error boundaries. */
export function captureApplicationFailure(
  error: unknown,
  context: ApplicationFailureContext,
): string | undefined {
  if (isBenignApplicationFailure(error, context)) return undefined
  // The visible route is not causal provenance. Recover a session/resource only
  // from a recently failed instrumented operation; otherwise keep this owned by
  // the application instead of manufacturing a misleading chat origin/action.
  const origin = correlatedFailureOrigin(APPLICATION_ORIGIN)
  const ts = Date.now()
  failureSequence += 1
  addEventTraceStep({
    traceId: `application-failure-${failureSequence.toString(36)}`,
    phase: 'failed',
    kind: `application.${context.kind ?? 'window'}`,
    summary: `${context.surface} failed`,
    origin,
    ts,
    attributes: failureAttributes(error, context),
  })
  // The key is how an error boundary's "Details" button lands on THIS crash instead of the top of
  // the journal. Publishing a second time just to obtain one would put two rows under one failure.
  return recordClientFact({
    severity: 'error',
    title: applicationFailureTitle(context),
    body: failureMessage(error),
    origin,
    occurredAt: ts,
    native: true,
  })
}

/** Last-resort journal entry for a failed mutation whose owner published nothing. */
export function publishUnreportedFailure(failure: UnreportedFailure): void {
  recordClientFact({
    severity: 'error',
    title: failure.title,
    origin: failure.origin,
    occurredAt: failure.ts,
  })
}

/** Installs one process-wide safety net. React boundaries provide more precise surface names. */
export function startGlobalErrorCapture(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    const error = event.error ?? event.message
    if (isBenignWindowDiagnostic(error)) {
      event.preventDefault()
      return
    }
    captureApplicationFailure(error, {
      surface: 'Application',
      kind: 'window',
    })
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (
      isBenignApplicationFailure(event.reason, {
        surface: 'Background operation',
        kind: 'promise',
      })
    ) {
      event.preventDefault()
      return
    }
    captureApplicationFailure(event.reason, {
      surface: 'Background operation',
      kind: 'promise',
    })
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}
