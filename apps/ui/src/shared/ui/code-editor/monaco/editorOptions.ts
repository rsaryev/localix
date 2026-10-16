import type * as Monaco from 'monaco-editor'
import { codeFontSize } from '@localixai/kit/lib'
import type { EditorCursorStatus } from '../types'
import type { CodeEditorProps } from '../codeEditorProps'
import { getWordWrap } from '../wordWrap'
import { getRenderWhitespace } from '../renderWhitespace'
import { getInlayHintsEnabled } from '../inlayHintsPref'
import type { MonacoApi } from './runtime'
import { defineLocalixMonacoTheme } from './theme'

export function cursorStatus(selection: Monaco.Selection): EditorCursorStatus {
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

export function editorFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
    "'Fragment Mono', ui-monospace, monospace"
  )
}

export function editorFontSize(): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--editor-font-size')
    .trim()
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : codeFontSize()
}

/** The options for the single `monaco.editor.create(...)` call, read from the mount-time props. */
export function createEditorOptions(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  props: CodeEditorProps,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    model,
    // BORN with the app's theme. `create` without a `theme` uses Monaco's default `vs`,
    // which is LIGHT — so every editor painted a white rectangle for the frames between
    // `create()` and the `setTheme` below, which is the "a piece of the screen is white on
    // startup" flash: the editor is the largest sub-surface in the app and Monaco is loaded
    // lazily, so those frames are real and visible (worst in dev). `watchLocalixMonacoTheme`
    // still owns every LATER flip; this only fixes the first paint.
    theme: defineLocalixMonacoTheme(monaco),
    automaticLayout: true,
    ariaLabel: props.ariaLabel,
    placeholder: props.placeholder,
    readOnly: props.readOnly,
    domReadOnly: props.readOnly,
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
      enabled: props.stickyScrollEnabled ?? true,
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
      enabled: props.bracketColorizationEnabled ?? true,
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
  }
}
