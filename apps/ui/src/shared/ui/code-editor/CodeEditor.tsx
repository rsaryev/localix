import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { CODE_VIEWER_HIGHLIGHT } from '@/shared/ui/code-block/sugarHighTheme'
import { observeScrollPercentTarget } from '@localixai/kit/scroll-sync'
import type {
  ApplyCodeActionSource,
  CodeActionSource,
  CompletionSource,
  DefinitionSource,
  DefinitionTargetSource,
  DocumentColorSource,
  DocumentHighlightSource,
  EditorContentChange,
  EditorCursorStatus,
  EditorDiagnostic,
  EditorRenameResult,
  EditorSuggestion,
  EditorTextSelection,
  FormatSource,
  FormatTextSource,
  HoverSource,
  InlayHintSource,
  PrepareRenameSource,
  RenameSource,
  SignatureHelpSource,
} from './types'
import type { DirtyChange, DirtyDiffFeed } from './dirtyDiffGutter'
import type { InlineBlameSource } from './inlineBlame'
import type { StickySymbol } from './stickyScroll'
import type { ViewStateBridge } from './viewState'
import type { MonacoEditorExtension } from './monaco/extensions'
import { disposeExtensionResult } from './monaco/extensions'
import { monacoLanguageId } from './language'
import { getWordWrap, setWordWrap, subscribeWordWrap } from './wordWrap'
import {
  getRenderWhitespace,
  setRenderWhitespace,
  subscribeRenderWhitespace,
} from './renderWhitespace'
import {
  getInlayHintsEnabled,
  setInlayHintsEnabled,
  subscribeInlayHintsEnabled,
} from './inlayHintsPref'
import { loadMonaco, type MonacoApi } from './monaco/runtime'
import { defineLocalixMonacoTheme, watchLocalixMonacoTheme } from './monaco/theme'
import { createDecorationSurface } from './monaco/decorations'
import { registerMonacoProviders } from './monaco/providers'
import { createDefinitionModelStore } from './monaco/definitionModels'
import { registerEditPredictionAdapter } from './monaco/editPrediction'
import { recordInlineAssistMetric } from '@/shared/lib/inlineAssistMetrics'
import { createEditorWidgets } from './monaco/editorWidgets'
import { stabilizeFindWidgetCloseButton } from './monaco/findWidget'
import { adoptStickyScrollMaterial } from './monaco/stickyMaterial'
import { registerMonacoNativeEditing } from './monaco/nativeEditing'
import { applyBufferEdit } from './monaco/bufferEdits'
import { onBufferEdits } from '@/shared/lib/bufferEditBus'
import { addEditorActions, type CodeEditorActionProps } from './monaco/actions'
import { createEditorHandle, type EditorHandle } from './editorHandle'
import { editorContextMenuEntries, localixActionIds } from './editorContextMenu'
import { minimalReplacement, modelHoldsValue, toEditorContentChanges } from './contentSync'
import type { NextEditSource } from './nextEditPrediction'
import { normalizeEditorSelection } from './selection'
import { createPendingWrite } from '@/shared/lib/quitFlush'
import { codeFontSize } from '@localixai/kit/lib'
import { LoadingHint } from '@localixai/kit/empty-hint'
import './monacoEditor.css'

/** Names each mounted editor's pending caret/scroll write in the quit-flush list. */
let editorInstanceSeq = 0

export type {
  EditorDiagnostic,
  EditorPosition,
  EditorCursorStatus,
  EditorCompletionItem,
  EditorDefinition,
  HoverSource,
  CompletionSource,
  DefinitionSource,
  DefinitionTargetSource,
  EditorSignatureHelp,
  SignatureHelpSource,
  EditorSelectionRange,
  CommentedRange,
  EditorReference,
  EditorCodeAction,
  DocumentHighlightSource,
  InlayHintSource,
  EditorInlayHint,
  DocumentColorSource,
  EditorColorInfo,
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

export interface CodeEditorProps extends CodeEditorActionProps {
  value: string
  language?: string
  readOnly?: boolean
  followTail?: boolean
  autoFocus?: boolean
  placeholder?: string
  /** The new full document, plus the deltas that produced it (absent for the very
   *  first/programmatic emissions). Consumers that only need to know WHAT changed
   *  should read `changes` instead of walking `value`. */
  onChange?: (value: string, changes?: readonly EditorContentChange[]) => void
  diagnostics?: EditorDiagnostic[]
  dirtyDiff?: DirtyDiffFeed
  /** Lines an external write just changed under this buffer — highlighted until the next user edit. */
  externalChanges?: readonly DirtyChange[]
  scrollbarMarkersEnabled?: boolean
  bracketColorizationEnabled?: boolean
  /** Compact data editors can keep all available height for the document. */
  stickyScrollEnabled?: boolean
  hoverSource?: HoverSource
  completionSource?: CompletionSource
  signatureHelpSource?: SignatureHelpSource
  nextEditSource?: NextEditSource
  nextEdit?: EditorSuggestion[] | null
  onNextEdit?: (suggestions: EditorSuggestion[] | null) => void
  onCursorLineChange?: (line: number) => void
  onCursorPositionChange?: (position: EditorCursorStatus) => void
  onSelectionChange?: (selection: EditorTextSelection | null) => void
  onEditorReady?: (api: EditorHandle) => void
  onScroll?: (percent: number) => void
  scrollSyncHost?: HTMLElement | null
  stickySymbols?: StickySymbol[]
  onFixRequest?: (diagnostic: EditorDiagnostic) => void
  definitionSource?: DefinitionSource
  definitionTargetSource?: DefinitionTargetSource
  documentHighlightSource?: DocumentHighlightSource
  inlayHintSource?: InlayHintSource
  blameSource?: InlineBlameSource
  documentColorSource?: DocumentColorSource
  prepareRenameSource?: PrepareRenameSource
  renameSource?: RenameSource
  onRenameApplied?: (result: EditorRenameResult) => void
  formatSource?: FormatSource
  formatText?: FormatTextSource
  codeActionSource?: CodeActionSource
  applyCodeActionSource?: ApplyCodeActionSource
  onCodeActionApplied?: (result: EditorRenameResult) => void
  onPeekDefinition?: (location: { file: string; line: number; character?: number }) => void
  initialLine?: number
  initialColumn?: number
  initialEndLine?: number
  initialEndColumn?: number
  revealKey?: number
  extensions?: MonacoEditorExtension[]
  viewState?: ViewStateBridge
  className?: string
  ariaLabel?: string
}

interface MountedEditor {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  decorations: ReturnType<typeof createDecorationSurface>
  widgets: ReturnType<typeof createEditorWidgets>
  definitionModels: ReturnType<typeof createDefinitionModelStore>
  provider?: Monaco.IDisposable
  prediction?: ReturnType<typeof registerEditPredictionAdapter>
  syncActionContexts?: () => void
  language: string
  /** (Re)register the language providers + edit prediction for `language` — mount and switch. */
  registerLanguage(): void
  dispose(): void
}

let editorSequence = 0

function cursorStatus(selection: Monaco.Selection): EditorCursorStatus {
  const selectedLines = selection.isEmpty()
    ? 0
    : Math.max(selection.endLineNumber - selection.startLineNumber + 1, 1)
  return {
    line: selection.positionLineNumber,
    column: selection.positionColumn,
    selectedChars: 0,
    selectedLines,
  }
}

function editorFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
    "'Fragment Mono', ui-monospace, monospace"
  )
}

function editorFontSize(): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--editor-font-size')
    .trim()
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : codeFontSize()
}

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
  /**
   * Mirror of the model's exact text, or `null` when it cannot be trusted. Maintained
   * at the ONLY two places the model's content can change out from under it:
   *   - the content listener below, which already materializes the text for `onChange`
   *     (and drops the mirror when nobody did, so nothing is ever assumed);
   *   - the external-value effect, which drops it after pushing a new value in.
   * It exists so the echo guard can answer "does the model already hold `value`?"
   * without re-materializing the document on every keystroke.
   */
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
      const id = ++editorSequence
      const path = latestPropsRef.current.filePath
      const modelUri = path
        ? monaco.Uri.file(path).with({ query: `localix-editor=${id}` })
        : monaco.Uri.parse(`inmemory://localix/editor-${id}`)
      const model = monaco.editor.createModel(
        latestPropsRef.current.value,
        monacoLanguageId(latestPropsRef.current.language ?? 'text'),
        modelUri,
      )
      const editor = monaco.editor.create(hostRef.current, {
        model,
        // BORN with the app's theme. `create` without a `theme` uses Monaco's default `vs`,
        // which is LIGHT — so every editor painted a white rectangle for the frames between
        // `create()` and the `setTheme` below, which is the "a piece of the screen is white on
        // startup" flash: the editor is the largest sub-surface in the app and Monaco is loaded
        // lazily, so those frames are real and visible (worst in dev). `watchLocalixMonacoTheme`
        // still owns every LATER flip; this only fixes the first paint.
        theme: defineLocalixMonacoTheme(monaco),
        automaticLayout: true,
        ariaLabel: latestPropsRef.current.ariaLabel,
        placeholder: latestPropsRef.current.placeholder,
        readOnly: latestPropsRef.current.readOnly,
        domReadOnly: latestPropsRef.current.readOnly,
        fontFamily: editorFontFamily(),
        fontSize: editorFontSize(),
        lineHeight: 20,
        fontLigatures: true,
        padding: { top: 8, bottom: 8 },
        minimap: { enabled: false },
        glyphMargin: true,
        lineNumbersMinChars: 3,
        folding: true,
        showFoldingControls: 'mouseover',
        stickyScroll: {
          enabled: latestPropsRef.current.stickyScrollEnabled ?? true,
          maxLineCount: 5,
        },
        scrollBeyondLastLine: true,
        smoothScrolling: true,
        roundedSelection: false,
        renderLineHighlight: 'all',
        renderWhitespace: getRenderWhitespace() ? 'selection' : 'none',
        wordWrap: getWordWrap() ? 'on' : 'off',
        inlayHints: { enabled: getInlayHintsEnabled() ? 'on' : 'off' },
        bracketPairColorization: {
          enabled: latestPropsRef.current.bracketColorizationEnabled ?? true,
        },
        guides: {
          indentation: true,
          highlightActiveIndentation: true,
          bracketPairs: true,
          bracketPairsHorizontal: 'active',
        },
        inlineSuggest: {
          enabled: true,
          mode: 'subwordSmart',
          showToolbar: 'onHover',
          syntaxHighlightingEnabled: true,
          suppressSuggestions: false,
          keepOnBlur: false,
        },
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        parameterHints: { enabled: true, cycle: true },
        fixedOverflowWidgets: true,
        // Off, but not absent: with `contextmenu: false` Monaco still focuses the editor and moves
        // the caret to the click, it just stops drawing its own menu and stops swallowing the
        // event — which is exactly the half this app wants, since the menu itself is described in
        // `editorContextMenu.ts` and drawn by the app's one context-menu surface.
        contextmenu: false,
        links: true,
        colorDecorators: true,
        // Alt owns multi-cursor, leaving Cmd/Ctrl+click for definitions.
        multiCursorModifier: 'alt',
        definitionLinkOpensInPeek: false,
        unicodeHighlight: {
          ambiguousCharacters: false,
          invisibleCharacters: true,
        },
      })
      const findWidgetProtection = stabilizeFindWidgetCloseButton(editor)
      const stickyMaterial = adoptStickyScrollMaterial(editor)

      const decorations = createDecorationSurface({
        monaco,
        editor,
        model,
        markerOwner: `localix-${id}`,
        isExternalChange: () => externalChangeRef.current,
      })
      const widgets = createEditorWidgets(editor, model)
      const definitionModels = createDefinitionModelStore(monaco)
      const extensionDisposables = (latestPropsRef.current.extensions ?? []).map((extension) =>
        extension.setup({ monaco, editor, model }),
      )
      const themeDispose = watchLocalixMonacoTheme(monaco, (theme) => monaco.editor.setTheme(theme))
      const wordWrapDispose = subscribeWordWrap((enabled) =>
        editor.updateOptions({ wordWrap: enabled ? 'on' : 'off' }),
      )
      const whitespaceDispose = subscribeRenderWhitespace((enabled) =>
        editor.updateOptions({
          renderWhitespace: enabled ? 'selection' : 'none',
        }),
      )
      const inlayDispose = subscribeInlayHintsEnabled((enabled) =>
        editor.updateOptions({
          inlayHints: { enabled: enabled ? 'on' : 'off' },
        }),
      )
      const typographyObserver = new MutationObserver(() => {
        editor.updateOptions({
          fontFamily: editorFontFamily(),
          fontSize: editorFontSize(),
        })
        monaco.editor.remeasureFonts()
      })
      typographyObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style'],
      })
      const actions: Monaco.IDisposable[] = []
      const otherDisposables: Monaco.IDisposable[] = []
      // A pending caret/scroll save is WRITTEN, never dropped: closing the tab or quitting
      // inside the 400 ms debounce used to clear the timer, so the file reopened at the
      // position before the last move. `dispose` below flushes it; quit/pagehide do too.
      const viewStateWrite = createPendingWrite(`code-editor:${++editorInstanceSeq}`, 400, () => {
        const bridge = latestPropsRef.current.viewState
        const position = editor.getPosition()
        if (!bridge || !position) return
        bridge.save({
          line: position.lineNumber,
          column: position.column - 1,
          top: editor.getVisibleRanges()[0]?.startLineNumber ?? 1,
        })
      })

      mounted = {
        monaco,
        editor,
        model,
        decorations,
        widgets,
        definitionModels,
        language: monacoLanguageId(latestPropsRef.current.language ?? 'text'),
        // Bound just below: registration reads this object back.
        registerLanguage: () => {},
        dispose() {
          // Before `editor.dispose()`: the write reads the caret from the live editor.
          viewStateWrite.dispose()
          mounted?.provider?.dispose()
          mounted?.prediction?.dispose()
          definitionModels.dispose()
          for (const disposable of actions) disposable.dispose()
          for (const disposable of otherDisposables) disposable.dispose()
          for (const result of extensionDisposables) disposeExtensionResult(result)
          wordWrapDispose()
          whitespaceDispose()
          inlayDispose()
          typographyObserver.disconnect()
          themeDispose()
          widgets.dispose()
          decorations.dispose()
          findWidgetProtection.dispose()
          stickyMaterial.dispose()
          editor.dispose()
          model.dispose()
        },
      }

      const registerLanguage = () => {
        if (!mounted) return
        mounted.provider?.dispose()
        mounted.prediction?.dispose()
        mounted.provider = registerMonacoProviders({
          monaco,
          editor,
          model,
          language: mounted.language,
          getSources: () => latestPropsRef.current,
          resolveDefinitionUri: (file, source) => definitionModels.resolve(file, source),
        })
        mounted.prediction = registerEditPredictionAdapter({
          monaco,
          editor,
          model,
          language: mounted.language,
          getController: () => {
            const current = latestPropsRef.current
            if (!current.nextEditSource || !current.onNextEdit) return undefined
            return {
              source: current.nextEditSource,
              current: current.nextEdit ?? null,
              onChange: current.onNextEdit,
              onOutcome: (outcome) =>
                recordInlineAssistMetric('editor', outcome.accepted ? 'accepted' : 'dismissed'),
            }
          },
          isReadOnly: () => latestPropsRef.current.readOnly ?? false,
          isExternalChange: () => externalChangeRef.current,
        })
      }
      mounted.registerLanguage = registerLanguage
      registerLanguage()
      actions.push(...addEditorActions(mounted, () => latestPropsRef.current))

      const scheduleViewState = viewStateWrite.schedule

      const publishSelection = (selection: Monaco.Selection) => {
        const normalized = normalizeEditorSelection(
          {
            line: selection.selectionStartLineNumber,
            column: selection.selectionStartColumn,
          },
          {
            line: selection.positionLineNumber,
            column: selection.positionColumn,
          },
          model.getValueInRange(selection),
        )
        latestPropsRef.current.onSelectionChange?.(normalized)
      }

      otherDisposables.push(
        registerMonacoNativeEditing(editor, () => latestPropsRef.current.readOnly ?? false),
        // A quick fix / rename for the file this editor holds arrives as edits for its buffer
        // (`bufferEditBus`), wherever it was requested from. Applied as one undoable step, or
        // refused when this buffer is no longer the text the edits were computed against.
        {
          dispose: onBufferEdits((edit) => {
            const current = latestPropsRef.current
            if (!current.filePath || edit.file !== current.filePath || current.readOnly) {
              return false
            }
            return applyBufferEdit(monaco, editor, model, edit)
          }),
        },
        model.onDidChangeContent((event) => {
          if (!externalChangeRef.current) {
            const onChange = latestPropsRef.current.onChange
            if (onChange) {
              // The one full read of the document per keystroke: the host's buffer IS
              // the whole text (dirty check, save, formatting), so nothing smaller can
              // stand in for it. Everything else on this path works off the deltas.
              const text = model.getValue()
              modelTextRef.current = text
              onChange(text, toEditorContentChanges(event.changes))
            } else {
              // Nobody materialized the new text, so the mirror is stale from here on.
              modelTextRef.current = null
            }
          }
          const selection = editor.getSelection()
          if (selection) publishSelection(selection)
          scheduleViewState()
        }),
        editor.onDidChangeCursorSelection((event) => {
          const selection = event.selection
          const selectedChars = model.getValueInRange(selection).length
          const status = cursorStatus(selection)
          latestPropsRef.current.onCursorLineChange?.(selection.positionLineNumber - 1)
          latestPropsRef.current.onCursorPositionChange?.({
            ...status,
            selectedChars,
          })
          publishSelection(selection)
          scheduleViewState()
        }),
        editor.onDidScrollChange((event) => {
          scheduleViewState()
          if (!event.scrollTopChanged || scrollGuardRef.current) return
          const max = Math.max(editor.getScrollHeight() - editor.getLayoutInfo().height, 0)
          latestPropsRef.current.onScroll?.(max > 0 ? editor.getScrollTop() / max : 0)
        }),
        editor.onDidChangeConfiguration((event) => {
          if (event.hasChanged(monaco.editor.EditorOption.wordWrap)) {
            setWordWrap(editor.getOption(monaco.editor.EditorOption.wordWrap) !== 'off')
          }
          if (event.hasChanged(monaco.editor.EditorOption.renderWhitespace)) {
            setRenderWhitespace(
              editor.getOption(monaco.editor.EditorOption.renderWhitespace) !== 'none',
            )
          }
          if (event.hasChanged(monaco.editor.EditorOption.inlayHints)) {
            setInlayHintsEnabled(
              editor.getOption(monaco.editor.EditorOption.inlayHints).enabled !== 'off',
            )
          }
        }),
      )

      const bridge = latestPropsRef.current.viewState
      if (bridge && !bridge.skipRestore?.()) {
        const snapshot = bridge.load()
        if (snapshot) {
          const lineNumber = Math.min(Math.max(snapshot.line, 1), model.getLineCount())
          const column = Math.min(
            Math.max(snapshot.column + 1, 1),
            model.getLineMaxColumn(lineNumber),
          )
          editor.setPosition({ lineNumber, column })
          editor.revealLineNearTop(
            Math.min(Math.max(snapshot.top, 1), model.getLineCount()),
            monaco.editor.ScrollType.Immediate,
          )
        }
      }

      runtimeRef.current = mounted
      decorations.setDiagnostics(latestPropsRef.current.diagnostics)
      decorations.setDirtyDiff(
        latestPropsRef.current.dirtyDiff,
        latestPropsRef.current.scrollbarMarkersEnabled ?? true,
      )
      decorations.setComments(latestPropsRef.current.commentRanges)
      void decorations.setBlameSource(latestPropsRef.current.blameSource)
      const initialReveal = latestPropsRef.current
      if (initialReveal.initialLine && initialReveal.initialLine >= 1) {
        const lineNumber = Math.min(initialReveal.initialLine, model.getLineCount())
        const column = Math.min(
          Math.max((initialReveal.initialColumn ?? 0) + 1, 1),
          model.getLineMaxColumn(lineNumber),
        )
        const endLineNumber = Math.min(
          Math.max(initialReveal.initialEndLine ?? lineNumber, lineNumber),
          model.getLineCount(),
        )
        const endColumn = initialReveal.initialEndLine
          ? Math.min(
              Math.max((initialReveal.initialEndColumn ?? 0) + 1, 1),
              model.getLineMaxColumn(endLineNumber),
            )
          : column
        editor.setSelection(new monaco.Selection(lineNumber, column, endLineNumber, endColumn))
        editor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Immediate)
        decorations.flashLine(lineNumber)
      }
      latestPropsRef.current.onEditorReady?.(
        createEditorHandle(
          monaco,
          editor,
          model,
          () => latestPropsRef.current,
          (lineNumber) => decorations.flashLine(lineNumber),
        ),
      )
      if (latestPropsRef.current.autoFocus) editor.focus()
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
    if (!runtime || !initialLine || initialLine < 1) return
    const lineNumber = Math.min(initialLine, runtime.model.getLineCount())
    const column = Math.min(
      Math.max((initialColumn ?? 0) + 1, 1),
      runtime.model.getLineMaxColumn(lineNumber),
    )
    const endLineNumber = Math.min(
      Math.max(initialEndLine ?? lineNumber, lineNumber),
      runtime.model.getLineCount(),
    )
    const endColumn = initialEndLine
      ? Math.min(
          Math.max((initialEndColumn ?? 0) + 1, 1),
          runtime.model.getLineMaxColumn(endLineNumber),
        )
      : column
    runtime.editor.setSelection(
      new runtime.monaco.Selection(lineNumber, column, endLineNumber, endColumn),
    )
    runtime.editor.revealLineInCenter(lineNumber, runtime.monaco.editor.ScrollType.Smooth)
    runtime.decorations.flashLine(lineNumber)
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
