import type * as Monaco from 'monaco-editor'
import type { EditorSuggestion } from '../types'
import {
  createNextEditCache,
  nextEditCacheKeyFromDigest,
  nextEditDocumentDigest,
  rotateHunks,
  survivingEditsAfterApply,
  type NextEditController,
} from '../nextEditPrediction'
import { classifyChangeSize, isEditPredictionEligible } from '../nextEditPredictionPolicy'
import type { MonacoApi } from './runtime'
import {
  suggestionRange,
  isValidSuggestion,
  narrowBundle,
  caretInsertion,
  editTouchesBundle,
} from './editPredictionAnchors'
import { recordInlineAssistMetric } from '@/shared/lib/inlineAssistMetrics'

interface EditPredictionAdapterOptions {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  language: string
  getController: () => NextEditController | undefined
  isReadOnly: () => boolean
  isExternalChange: () => boolean
}

interface ActiveInlineEdit {
  suggestion: EditorSuggestion
  bundle: EditorSuggestion[]
  correlationId: string
  /** The server requestId that produced this bundle — the join key for its outcome event. */
  requestId: string
  documentVersion: number
}

const MAX_AUTOMATIC_PREDICTION_CHARS = 500_000

function createRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `next-edit:${Date.now()}:${Math.random().toString(36).slice(2)}`
  )
}

/**
 * Bridges Localix's multi-hunk prediction source into Monaco's native inline-edit
 * contribution. Monaco owns preview layout, Tab jump/accept, Escape reject, suggest
 * widget suppression, accessibility, undo stops, and cancellation/version races.
 */
export function registerEditPredictionAdapter(options: EditPredictionAdapterOptions) {
  const { monaco, editor, model } = options
  let cache = createNextEditCache()
  const listeners = new Set<(event: void) => unknown>()
  let composing = false
  let oversizedPaste = false
  let bulkEdit = false
  let pending: EditorSuggestion[] | null = options.getController()?.current ?? null
  let active: ActiveInlineEdit | null = null
  let requestGeneration = 0
  let activeRequest: AbortController | null = null
  let lastSource: NextEditController['source']
  /** requestId of the most recent server round-trip, carried onto the offer it produced. */
  let lastRequestId = ''
  let disposed = false
  let dismissedVersion: number | undefined
  let refreshHunkContext = () => {}

  const fire = () => {
    for (const listener of listeners) listener()
  }

  const publish = (next: EditorSuggestion[] | null) => {
    pending = next?.length ? next : null
    options.getController()?.onChange(pending)
    refreshHunkContext()
    fire()
  }

  const invalidate = (notifyHost = true) => {
    requestGeneration++
    activeRequest?.abort()
    activeRequest = null
    active = null
    pending = null
    if (notifyHost) options.getController()?.onChange(null)
    refreshHunkContext()
    fire()
  }

  const event: Monaco.IEvent<void> = (listener) => {
    listeners.add(listener)
    return { dispose: () => listeners.delete(listener) }
  }

  const contentDisposable = model.onDidChangeContent((change) => {
    if (disposed || options.isExternalChange()) return
    requestGeneration++
    activeRequest?.abort()
    activeRequest = null
    if (pending) {
      // Typing the prediction out by hand must not cost a new model call; an edit
      // anywhere else makes the bundle a prediction for text that no longer exists.
      const narrowed = editTouchesBundle(change.changes, pending)
        ? narrowBundle(model, pending)
        : null
      pending = narrowed
      options.getController()?.onChange(narrowed)
    }
    // One measurement, from the inserted text, for every kind of change. There is no
    // `onDidPaste` handler by design — see `classifyChangeSize`.
    ;({ oversizedPaste, bulkEdit } = classifyChangeSize(change.changes, change.isFlush))
  })
  const compositionStart = editor.onDidCompositionStart(() => {
    composing = true
  })
  const compositionEnd = editor.onDidCompositionEnd(() => {
    composing = false
  })

  const provider: Monaco.languages.InlineCompletionsProvider = {
    // Monaco owns cancellation/version checks around this debounce.
    // Keep one short delay instead of stacking a
    // second timer inside the provider.
    debounceDelayMs: 100,
    onDidChangeInlineCompletions: event,
    async provideInlineCompletions(currentModel, position, context, token) {
      if (
        disposed ||
        currentModel !== model ||
        (!context.includeInlineEdits && !context.includeInlineCompletions)
      )
        return { items: [] }
      const controller = options.getController()
      if (!controller?.source) {
        if (lastSource) {
          lastSource = undefined
          dismissedVersion = undefined
          invalidate(false)
        }
        return { items: [] }
      }
      const manual = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit
      if (controller.source !== lastSource) {
        lastSource = controller.source
        dismissedVersion = undefined
        cache = createNextEditCache()
        pending = controller.current?.length ? controller.current : null
      }
      if (!manual && dismissedVersion === model.getVersionId()) return { items: [] }

      const live = manual ? null : (pending ?? controller.current)
      const existing = live?.length ? narrowBundle(model, live) : null
      if (existing?.length) {
        pending = existing
      } else {
        if (!manual && model.getValueLength() > MAX_AUTOMATIC_PREDICTION_CHARS) {
          return { items: [] }
        }
        const eligibility = isEditPredictionEligible({
          docEmpty: model.getValueLength() === 0,
          readOnly: options.isReadOnly(),
          composing,
          // Monaco suppresses inline edits while the suggest widget or a
          // focused hover owns Tab; the native contribution is the source of truth.
          completionOpen: false,
          bulkEdit,
          oversizedPaste,
          manual,
          inBackoff: false,
        })
        bulkEdit = false
        oversizedPaste = false
        if (!eligibility.eligible) return { items: [] }

        const content = model.getValue()
        const version = model.getVersionId()
        const digest = nextEditDocumentDigest(content)
        const key = nextEditCacheKeyFromDigest(digest, position.lineNumber, position.column - 1)
        const cached = manual ? undefined : cache.get(key)
        if (cached) {
          pending = cached.edits
          controller.onChange(pending?.length ? pending : null)
        } else {
          const pendingRequestId = createRequestId()
          const generation = ++requestGeneration
          activeRequest?.abort()
          const controllerAbort = new AbortController()
          activeRequest = controllerAbort
          const cancellation = token.onCancellationRequested(() => controllerAbort.abort())
          let result: EditorSuggestion[] | null
          try {
            result = await controller.source(
              {
                content,
                cursorLine: position.lineNumber,
                cursorColumn: position.column - 1,
                documentVersion: version,
                documentDigest: digest,
                requestId: pendingRequestId,
              },
              controllerAbort.signal,
            )
          } catch {
            if (!controllerAbort.signal.aborted) {
              recordInlineAssistMetric('editor', 'error')
            }
            return { items: [] }
          } finally {
            cancellation.dispose()
            if (activeRequest === controllerAbort) activeRequest = null
          }
          if (
            disposed ||
            generation !== requestGeneration ||
            token.isCancellationRequested ||
            model.getVersionId() !== version
          )
            return { items: [] }
          pending = result?.filter((suggestion) => isValidSuggestion(model, suggestion)) ?? null
          lastRequestId = pendingRequestId
          cache.set(key, pending)
          controller.onChange(pending?.length ? pending : null)
        }
      }

      refreshHunkContext()
      const suggestion = pending?.[0]
      if (!suggestion) return { items: [] }
      const insertion = context.includeInlineCompletions
        ? caretInsertion(suggestion, position)
        : null
      if (insertion === null && !context.includeInlineEdits) return { items: [] }
      const correlationId = `${suggestion.id}:${requestGeneration}:${createRequestId()}`
      active = {
        suggestion,
        bundle: pending ? [...pending] : [suggestion],
        correlationId,
        requestId: lastRequestId,
        documentVersion: model.getVersionId(),
      }
      const range =
        insertion !== null
          ? new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            )
          : suggestionRange(monaco, model, suggestion)
      return {
        items: [
          {
            insertText: insertion ?? suggestion.replacement ?? '',
            range,
            isInlineEdit: insertion === null,
            correlationId,
            hint:
              insertion === null
                ? {
                    range,
                    style: monaco.languages.InlineCompletionHintStyle.Label,
                    content: 'Next edit',
                    jumpToEdit: true,
                  }
                : undefined,
          },
        ],
        enableForwardStability: false,
      }
    },
    disposeInlineCompletions() {},
    handleEndOfLifetime(_completions, item, reason) {
      if (!active || item.correlationId !== active.correlationId) return
      const completed = active
      active = null
      // Whether the user TOOK the suggestion is the only direct measure of its quality, and it
      // was thrown away here: Monaco reports the reason and nothing recorded it. Continue infers
      // the same signal with a 10s rejection timer (`AutocompleteLoggingService.markDisplayed`)
      // because it has no such event; we do, so no timer is needed. `requestId` joins this to the
      // server-side `NextEditOutcome` already emitted for the prediction.
      options.getController()?.onOutcome?.({
        requestId: completed.requestId,
        accepted: reason.kind === monaco.languages.InlineCompletionEndOfLifeReasonKind.Accepted,
        hunks: completed.bundle.length,
      })
      if (reason.kind === monaco.languages.InlineCompletionEndOfLifeReasonKind.Accepted) {
        const remaining = completed.bundle.filter((item) => item.id !== completed.suggestion.id)
        publish(survivingEditsAfterApply(remaining, completed.suggestion, model.getValue()))
        return
      }
      if (reason.kind === monaco.languages.InlineCompletionEndOfLifeReasonKind.Rejected) {
        // A callback for a previous document cannot dismiss the newer draft.
        if (completed.documentVersion === model.getVersionId()) {
          dismissedVersion = completed.documentVersion
          publish(null)
        }
      }
    },
  }

  const providerDisposable = monaco.languages.registerInlineCompletionsProvider(
    options.language,
    provider,
  )
  const requestAction = editor.addAction({
    id: `localix.nextEdit.request.${editor.getId()}`,
    label: 'Request Inline Suggestion',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Backslash],
    precondition: 'editorTextFocus && !editorReadonly',
    run: () => {
      editor.trigger('localix', 'editor.action.inlineSuggest.trigger', {})
    },
  })
  const hasMultipleHunks = editor.createContextKey<boolean>('localixHasMultipleNextEdits', false)
  refreshHunkContext = () => hasMultipleHunks.set(Boolean(pending && pending.length > 1))
  const rotate = (direction: 'next' | 'prev') => {
    if (!pending || pending.length <= 1) return
    pending = rotateHunks(pending, direction)
    options.getController()?.onChange(pending)
    active = null
    const target = pending[0]
    if (target) editor.revealLineInCenterIfOutsideViewport(target.startLine)
    refreshHunkContext()
    fire()
  }
  const nextHunkAction = editor.addAction({
    id: `localix.nextEdit.nextHunk.${editor.getId()}`,
    label: 'Next Edit Prediction Hunk',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.BracketRight],
    precondition: 'editorTextFocus && localixHasMultipleNextEdits',
    run: () => rotate('next'),
  })
  const previousHunkAction = editor.addAction({
    id: `localix.nextEdit.previousHunk.${editor.getId()}`,
    label: 'Previous Edit Prediction Hunk',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.BracketLeft],
    precondition: 'editorTextFocus && localixHasMultipleNextEdits',
    run: () => rotate('prev'),
  })
  refreshHunkContext()

  return {
    sync(next: EditorSuggestion[] | null): void {
      if (next === pending) return
      pending = next?.length ? next : null
      active = null
      refreshHunkContext()
      fire()
    },
    invalidate(): void {
      invalidate()
      refreshHunkContext()
    },
    dispose(): void {
      disposed = true
      listeners.clear()
      requestGeneration++
      activeRequest?.abort()
      providerDisposable.dispose()
      requestAction.dispose()
      nextHunkAction.dispose()
      previousHunkAction.dispose()
      hasMultipleHunks.reset()
      contentDisposable.dispose()
      compositionStart.dispose()
      compositionEnd.dispose()
    },
  }
}
