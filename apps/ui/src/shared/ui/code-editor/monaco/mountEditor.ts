import type * as Monaco from 'monaco-editor'
import type { CodeEditorProps } from '../codeEditorProps'
import { monacoLanguageId } from '../language'
import { createEditorHandle } from '../editorHandle'
import { subscribeWordWrap } from '../wordWrap'
import { subscribeRenderWhitespace } from '../renderWhitespace'
import { subscribeInlayHintsEnabled } from '../inlayHintsPref'
import { restoredPosition, revealSelection } from '../revealRange'
import { createPendingWrite } from '@/shared/lib/quitFlush'
import { recordInlineAssistMetric } from '@/shared/lib/inlineAssistMetrics'
import { disposeExtensionResult } from './extensions'
import type { MonacoApi } from './runtime'
import { watchLocalixMonacoTheme } from './theme'
import { createDecorationSurface } from './decorations'
import { registerMonacoProviders } from './providers'
import { createDefinitionModelStore } from './definitionModels'
import { registerEditPredictionAdapter } from './editPrediction'
import { createEditorWidgets } from './editorWidgets'
import { stabilizeFindWidgetCloseButton } from './findWidget'
import { adoptStickyScrollMaterial } from './stickyMaterial'
import { addEditorActions } from './actions'
import { createEditorOptions, editorFontFamily, editorFontSize } from './editorOptions'
import { bindEditorListeners, type EditorSyncRefs } from './editorListeners'

/** Names each mounted editor's pending caret/scroll write in the quit-flush list. */
let editorInstanceSeq = 0
let editorSequence = 0

export interface MountedEditor {
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

/** Builds the Monaco editor for one `CodeEditor` host and wires every listener and surface. */
export function mountCodeEditor(
  monaco: MonacoApi,
  host: HTMLElement,
  getProps: () => CodeEditorProps,
  refs: EditorSyncRefs,
): MountedEditor {
  const initial = getProps()
  const id = ++editorSequence
  const path = initial.filePath
  const modelUri = path
    ? monaco.Uri.file(path).with({ query: `localix-editor=${id}` })
    : monaco.Uri.parse(`inmemory://localix/editor-${id}`)
  const model = monaco.editor.createModel(
    initial.value,
    monacoLanguageId(initial.language ?? 'text'),
    modelUri,
  )
  const editor = monaco.editor.create(host, createEditorOptions(monaco, model, initial))
  const findWidgetProtection = stabilizeFindWidgetCloseButton(editor)
  const stickyMaterial = adoptStickyScrollMaterial(editor)

  const decorations = createDecorationSurface({
    monaco,
    editor,
    model,
    markerOwner: `localix-${id}`,
    isExternalChange: () => refs.externalChange.current,
  })
  const widgets = createEditorWidgets(editor, model)
  const definitionModels = createDefinitionModelStore(monaco)
  const extensionDisposables = (initial.extensions ?? []).map((extension) =>
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
    const bridge = getProps().viewState
    const position = editor.getPosition()
    if (!bridge || !position) return
    bridge.save({
      line: position.lineNumber,
      column: position.column - 1,
      top: editor.getVisibleRanges()[0]?.startLineNumber ?? 1,
    })
  })

  const mounted: MountedEditor = {
    monaco,
    editor,
    model,
    decorations,
    widgets,
    definitionModels,
    language: monacoLanguageId(initial.language ?? 'text'),
    registerLanguage: () => {
      mounted.provider?.dispose()
      mounted.prediction?.dispose()
      mounted.provider = registerMonacoProviders({
        monaco,
        editor,
        model,
        language: mounted.language,
        getSources: getProps,
        resolveDefinitionUri: (file, source) => definitionModels.resolve(file, source),
      })
      mounted.prediction = registerEditPredictionAdapter({
        monaco,
        editor,
        model,
        language: mounted.language,
        getController: () => {
          const current = getProps()
          if (!current.nextEditSource || !current.onNextEdit) return undefined
          return {
            source: current.nextEditSource,
            current: current.nextEdit ?? null,
            onChange: current.onNextEdit,
            onOutcome: (outcome) =>
              recordInlineAssistMetric('editor', outcome.accepted ? 'accepted' : 'dismissed'),
          }
        },
        isReadOnly: () => getProps().readOnly ?? false,
        isExternalChange: () => refs.externalChange.current,
      })
    },
    dispose() {
      // Before `editor.dispose()`: the write reads the caret from the live editor.
      viewStateWrite.dispose()
      mounted.provider?.dispose()
      mounted.prediction?.dispose()
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
  mounted.registerLanguage()
  actions.push(...addEditorActions(mounted, getProps))

  otherDisposables.push(
    ...bindEditorListeners({
      monaco,
      editor,
      model,
      getProps,
      refs,
      scheduleViewState: viewStateWrite.schedule,
    }),
  )

  const bridge = initial.viewState
  if (bridge && !bridge.skipRestore?.()) {
    const snapshot = bridge.load()
    if (snapshot) {
      const restored = restoredPosition(model, snapshot)
      editor.setPosition({ lineNumber: restored.lineNumber, column: restored.column })
      editor.revealLineNearTop(restored.top, monaco.editor.ScrollType.Immediate)
    }
  }
  return mounted
}

/** Seeds decorations, applies the initial reveal and announces the handle once mounted. */
export function initializeMountedEditor(mounted: MountedEditor, props: CodeEditorProps): void {
  const { monaco, decorations } = mounted
  decorations.setDiagnostics(props.diagnostics)
  decorations.setDirtyDiff(props.dirtyDiff, props.scrollbarMarkersEnabled ?? true)
  decorations.setComments(props.commentRanges)
  void decorations.setBlameSource(props.blameSource)
  revealInEditor(mounted, props, monaco.editor.ScrollType.Immediate)
}

/** Selects and centres the requested `initialLine…` range, flashing its first line. */
export function revealInEditor(
  mounted: MountedEditor,
  props: Pick<
    CodeEditorProps,
    'initialLine' | 'initialColumn' | 'initialEndLine' | 'initialEndColumn'
  >,
  scrollType: Monaco.editor.ScrollType,
): void {
  const range = revealSelection(mounted.model, {
    line: props.initialLine,
    column: props.initialColumn,
    endLine: props.initialEndLine,
    endColumn: props.initialEndColumn,
  })
  if (!range) return
  mounted.editor.setSelection(
    new mounted.monaco.Selection(
      range.lineNumber,
      range.column,
      range.endLineNumber,
      range.endColumn,
    ),
  )
  mounted.editor.revealLineInCenter(range.lineNumber, scrollType)
  mounted.decorations.flashLine(range.lineNumber)
}

export function announceEditorHandle(mounted: MountedEditor, getProps: () => CodeEditorProps) {
  const { monaco, editor, model, decorations } = mounted
  getProps().onEditorReady?.(
    createEditorHandle(monaco, editor, model, getProps, (lineNumber) =>
      decorations.flashLine(lineNumber),
    ),
  )
}
