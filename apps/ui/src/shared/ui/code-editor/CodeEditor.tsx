import { useEffect, useRef, useState } from 'react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { CODE_VIEWER_HIGHLIGHT } from '@/shared/ui/code-block/sugarHighTheme'
import { observeScrollPercentTarget } from '@localixai/kit/scroll-sync'
import { LoadingHint } from '@localixai/kit/empty-hint'
import type { CodeEditorProps } from './codeEditorProps'
import { monacoLanguageId } from './language'
import { loadMonaco } from './monaco/runtime'
import {
  announceEditorHandle,
  initializeMountedEditor,
  mountCodeEditor,
  revealInEditor,
  type MountedEditor,
} from './monaco/mountEditor'
import type { EditorSyncRefs } from './monaco/editorListeners'
import { editorContextMenuEntries, localixActionIds } from './editorContextMenu'
import { minimalReplacement, modelHoldsValue } from './contentSync'
import './monacoEditor.css'

export type {
  EditorDiagnostic,
  EditorPosition,
  EditorCursorStatus,
  EditorCompletionItem,
  HoverSource,
  CompletionSource,
  DefinitionSource,
  DefinitionTargetSource,
  SignatureHelpSource,
  EditorSelectionRange,
  EditorCodeAction,
  DocumentHighlightSource,
  InlayHintSource,
  DocumentColorSource,
  EditorHunk,
  EditorSuggestion,
  EditorTextSelection,
  EditorContentChange,
  EditorRenameResult,
  FormatTextSource,
} from './types'
export type { NextEditSource, NextEditRequest } from './nextEditPrediction'
export type { EditorHandle } from './editorHandle'
export type { MonacoEditorExtension } from './monaco/extensions'
export type { CodeEditorProps } from './codeEditorProps'

/** Monaco-backed editor primitive. Backend and feature-layer contracts stay editor-agnostic. */
export function CodeEditor(props: CodeEditorProps) {
  const {
    value,
    language = 'text',
    readOnly = false,
    followTail = false,
    diagnostics,
    dirtyDiff,
    externalChanges,
    scrollbarMarkersEnabled = true,
    bracketColorizationEnabled = true,
    stickyScrollEnabled = true,
    nextEdit,
    commentRanges,
    stickySymbols,
    blameSource,
    initialLine,
    initialColumn,
    initialEndLine,
    initialEndColumn,
    revealKey,
    scrollSyncHost,
    className,
    ariaLabel,
    placeholder,
  } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<MountedEditor | null>(null)
  const latestPropsRef = useRef(props)
  const externalChangeRef = useRef(false)
  const scrollGuardRef = useRef(false)
  /** Mirror of the model's exact text, or `null` when it cannot be trusted (see `EditorSyncRefs`). */
  const modelTextRef = useRef<string | null>(null)
  /** The right-click menu's rows, rebuilt from the live editor each time it opens. */
  const [menuEntries, setMenuEntries] = useState<MenuEntry[]>([])
  const [editorReady, setEditorReady] = useState(false)

  useEffect(() => {
    latestPropsRef.current = props
    runtimeRef.current?.syncActionContexts?.()
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let mounted: MountedEditor | null = null
    void loadMonaco().then((monaco) => {
      if (cancelled || !hostRef.current) return
      const getProps = () => latestPropsRef.current
      const refs: EditorSyncRefs = {
        externalChange: externalChangeRef,
        scrollGuard: scrollGuardRef,
        modelText: modelTextRef,
      }
      mounted = mountCodeEditor(monaco, hostRef.current, getProps, refs)
      runtimeRef.current = mounted
      initializeMountedEditor(mounted, latestPropsRef.current)
      announceEditorHandle(mounted, getProps)
      if (latestPropsRef.current.autoFocus) mounted.editor.focus()
      setEditorReady(true)
    })
    return () => {
      cancelled = true
      mounted?.dispose()
      if (runtimeRef.current === mounted) runtimeRef.current = null
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    // Echo guard — unchanged in meaning: when the model ALREADY holds `value` (the
    // common case: our own `onChange` returning through React state) do nothing.
    // Re-setting it would clear the undo stack and the caret, and an external update
    // that bounced back would fight the user's typing. The mirror only ever holds text
    // the model provably contains, and falls back to reading the model when it is null,
    // so the decision is identical to comparing against `model.getValue()`.
    if (modelHoldsValue(modelTextRef.current, value, () => runtime.model.getValue())) return
    externalChangeRef.current = true
    // Only the span that differs is replaced (`minimalReplacement`): `setValue` sent the caret
    // to the top and wiped undo every time an agent's edit reloaded into the open buffer.
    const replacement = minimalReplacement(runtime.model.getValue(), value)
    if (replacement) {
      const { model } = runtime
      const start = model.getPositionAt(replacement.start)
      const end = model.getPositionAt(replacement.end)
      runtime.editor.pushUndoStop()
      model.pushEditOperations(
        runtime.editor.getSelections(),
        [
          {
            range: new runtime.monaco.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            ),
            text: replacement.text,
          },
        ],
        () => null,
      )
      runtime.editor.pushUndoStop()
    }
    externalChangeRef.current = false
    // setValue may normalize (line endings), so what the model now holds is not
    // necessarily `value` — drop the mirror rather than assume.
    modelTextRef.current = null
    runtime.prediction?.invalidate()
    if (followTail) runtime.editor.revealLine(runtime.model.getLineCount())
  }, [value, followTail])

  // After the value effect above (effects run in declaration order), so the lines are marked on
  // the text they describe.
  useEffect(() => {
    runtimeRef.current?.decorations.setExternalChanges(externalChanges)
  }, [externalChanges])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const nextLanguage = monacoLanguageId(language)
    if (runtime.language === nextLanguage) return
    runtime.language = nextLanguage
    runtime.monaco.editor.setModelLanguage(runtime.model, nextLanguage)
    runtime.registerLanguage()
  }, [language])

  useEffect(() => {
    runtimeRef.current?.editor.updateOptions({
      readOnly,
      domReadOnly: readOnly,
    })
  }, [readOnly])

  useEffect(() => {
    runtimeRef.current?.editor.updateOptions({
      bracketPairColorization: { enabled: bracketColorizationEnabled },
      ariaLabel,
      placeholder,
    })
  }, [bracketColorizationEnabled, ariaLabel, placeholder])

  useEffect(() => {
    runtimeRef.current?.decorations.setDiagnostics(diagnostics)
  }, [diagnostics])

  useEffect(() => {
    runtimeRef.current?.decorations.setDirtyDiff(dirtyDiff, scrollbarMarkersEnabled)
  }, [dirtyDiff, scrollbarMarkersEnabled])

  useEffect(() => {
    runtimeRef.current?.decorations.setComments(commentRanges)
  }, [commentRanges])

  useEffect(() => {
    void runtimeRef.current?.decorations.setBlameSource(blameSource)
  }, [blameSource])

  useEffect(() => {
    runtimeRef.current?.prediction?.sync(nextEdit ?? null)
  }, [nextEdit])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    revealInEditor(
      runtime,
      { initialLine, initialColumn, initialEndLine, initialEndColumn },
      runtime.monaco.editor.ScrollType.Smooth,
    )
  }, [initialLine, initialColumn, initialEndLine, initialEndColumn, revealKey])

  useEffect(() => {
    if (!scrollSyncHost) return
    return observeScrollPercentTarget(scrollSyncHost, (percent) => {
      const runtime = runtimeRef.current
      if (!runtime) return
      const max = Math.max(
        runtime.editor.getScrollHeight() - runtime.editor.getLayoutInfo().height,
        0,
      )
      scrollGuardRef.current = true
      runtime.editor.setScrollTop(percent * max, runtime.monaco.editor.ScrollType.Immediate)
      requestAnimationFrame(() => {
        scrollGuardRef.current = false
      })
    })
  }, [scrollSyncHost])

  // Refresh the outline without re-enabling pinned rows in compact data editors.
  useEffect(() => {
    runtimeRef.current?.editor.updateOptions({
      stickyScroll: { enabled: stickyScrollEnabled, maxLineCount: 5 },
    })
  }, [stickySymbols, stickyScrollEnabled])

  return (
    <ContextMenu
      onOpenChange={(open) => {
        // Built on OPEN, not memoized: almost every row's availability is live editor state React
        // never sees — which providers answered for this language, whether the caret sits on a
        // changed hunk, whether there is a selection. A list captured at render time offers Revert
        // Change on an unmodified line. See `editorContextMenu.ts`.
        if (!open) return
        const runtime = runtimeRef.current
        if (!runtime) return
        setMenuEntries(
          editorContextMenuEntries({
            editor: runtime.editor,
            model: runtime.model,
            actionIds: localixActionIds(runtime.editor.getId()),
            readOnly: latestPropsRef.current.readOnly ?? false,
          }),
        )
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="true"
          aria-busy={!editorReady}
          aria-readonly={readOnly}
          className={cn(
            'localix-monaco-editor relative h-full min-h-0 overflow-hidden',
            CODE_VIEWER_HIGHLIGHT,
            className,
          )}
        >
          <div ref={hostRef} className="h-full min-h-0" />
          {!editorReady && (
            <LoadingHint className="pointer-events-none absolute inset-0">
              Opening editor…
            </LoadingHint>
          )}
        </div>
      </ContextMenuTrigger>
      {menuEntries.length > 0 && (
        // Radix hands focus back to the trigger on close, and the trigger here is Monaco's own
        // container — not focusable, so focus would land on the body. Every row re-focuses the
        // editor itself a frame later (`runInEditor`), which also leaves the rename input and the
        // command palette holding the focus they took.
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <MenuEntries entries={menuEntries} family="context" />
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
