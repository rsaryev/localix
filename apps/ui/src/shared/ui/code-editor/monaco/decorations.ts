import type * as Monaco from 'monaco-editor'
import type { DirtyChange, DirtyDiffFeed } from '../dirtyDiffGutter'
import { formatBlame, type InlineBlameLine, type InlineBlameSource } from '../inlineBlame'
import type { CommentedRange, EditorDiagnostic } from '../types'
import type { MonacoApi } from './runtime'
import { createInlineBlameWidget } from './inlineBlameWidget'

function markerSeverity(monaco: MonacoApi, severity: EditorDiagnostic['severity']) {
  switch (severity) {
    case 'error':
      return monaco.MarkerSeverity.Error
    case 'warning':
      return monaco.MarkerSeverity.Warning
    case 'info':
      return monaco.MarkerSeverity.Info
    case 'hint':
      return monaco.MarkerSeverity.Hint
  }
}

export function createDecorationSurface(options: {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  markerOwner: string
  /** Whether the content change being reported was pushed in from outside (not typed). */
  isExternalChange: () => boolean
}) {
  const { monaco, editor, model, markerOwner } = options
  const dirty = editor.createDecorationsCollection()
  // Lines an external write changed (`externalChanges.ts`). Decorations follow their lines
  // through later edits; the person's first own edit means they have seen them, and clears.
  const external = editor.createDecorationsCollection()
  const comments = editor.createDecorationsCollection()
  const blame = createInlineBlameWidget(monaco, editor, model)
  const flash = editor.createDecorationsCollection()
  let blameAbort: AbortController | null = null
  let blameLines = new Map<number, InlineBlameLine>()
  let blameTimer: ReturnType<typeof setTimeout> | undefined
  let blameReloadTimer: ReturnType<typeof setTimeout> | undefined
  let currentBlameSource: InlineBlameSource | undefined
  let disposed = false

  const renderBlameAtCursor = () => {
    blame.set()
    if (blameTimer) clearTimeout(blameTimer)
    blameTimer = setTimeout(() => {
      const position = editor.getPosition()
      const line = position ? blameLines.get(position.lineNumber) : undefined
      if (!position || !line) {
        blame.set()
        return
      }
      blame.set(
        position.lineNumber,
        formatBlame(line),
        line.uncommitted ? undefined : line.onSelect,
      )
    }, 250)
  }

  const cursorDisposable = editor.onDidChangeCursorPosition(renderBlameAtCursor)

  const loadBlame = async (source: InlineBlameSource | undefined) => {
    blameAbort?.abort()
    blameAbort = null
    blameLines = new Map()
    blame.set()
    if (!source || disposed) return
    const controller = new AbortController()
    blameAbort = controller
    const lines = await source(controller.signal).catch(() => null)
    if (disposed || controller.signal.aborted || !lines) return
    blameLines = new Map(lines.map((line) => [line.line, line]))
    renderBlameAtCursor()
  }

  const contentDisposable = model.onDidChangeContent(() => {
    if (!options.isExternalChange() && external.length > 0) external.clear()
    blame.set()
    blameLines = new Map()
    blameAbort?.abort()
    if (blameReloadTimer) clearTimeout(blameReloadTimer)
    blameReloadTimer = setTimeout(() => void loadBlame(currentBlameSource), 700)
  })

  return {
    setDiagnostics(diagnostics: EditorDiagnostic[] | undefined): void {
      const markers: Monaco.editor.IMarkerData[] = (diagnostics ?? []).map((diagnostic) => {
        const startLineNumber = Math.min(Math.max(diagnostic.line + 1, 1), model.getLineCount())
        const endLineNumber = Math.min(
          Math.max(diagnostic.endLine + 1, startLineNumber),
          model.getLineCount(),
        )
        return {
          startLineNumber,
          startColumn: Math.min(
            Math.max(diagnostic.character + 1, 1),
            model.getLineMaxColumn(startLineNumber),
          ),
          endLineNumber,
          endColumn: Math.min(
            Math.max(diagnostic.endCharacter + 1, 1),
            model.getLineMaxColumn(endLineNumber),
          ),
          severity: markerSeverity(monaco, diagnostic.severity),
          message: diagnostic.message,
          source: diagnostic.source,
          code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
          // Monaco's own rendering: Unnecessary fades the span (`editorUnnecessaryCode.*` in
          // the theme) and, on a hint, replaces the dotted underline; Deprecated strikes it.
          tags: diagnostic.tags?.map((tag) =>
            tag === 'unnecessary' ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated,
          ),
        }
      })
      monaco.editor.setModelMarkers(model, markerOwner, markers)
    },
    setDirtyDiff(feed: DirtyDiffFeed | undefined, overviewEnabled: boolean): void {
      const decorations: Monaco.editor.IModelDeltaDecoration[] = []
      for (const change of feed?.changes ?? []) {
        const start = Math.min(Math.max(change.fromLine, 1), model.getLineCount())
        const end = Math.min(Math.max(change.toLine, start), model.getLineCount())
        const type = `localix-monaco-dirty-${change.type}`
        const layer = change.layer === 'secondary' ? ' localix-monaco-dirty-secondary' : ''
        decorations.push({
          range: new monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: `${type}${layer}`,
            overviewRuler: overviewEnabled
              ? {
                  color:
                    change.type === 'added'
                      ? '#3fb950'
                      : change.type === 'deleted'
                        ? '#f85149'
                        : '#58a6ff',
                  position: monaco.editor.OverviewRulerLane.Left,
                }
              : undefined,
          },
        })
      }
      for (const mark of feed?.wordMarks ?? []) {
        if (mark.line < 1 || mark.line > model.getLineCount()) continue
        const maxColumn = model.getLineMaxColumn(mark.line)
        const startColumn = Math.min(Math.max(mark.from + 1, 1), maxColumn)
        const endColumn = Math.min(Math.max(mark.to + 1, startColumn), maxColumn)
        if (endColumn <= startColumn) continue
        decorations.push({
          range: new monaco.Range(mark.line, startColumn, mark.line, endColumn),
          options: { inlineClassName: 'localix-monaco-word-diff' },
        })
      }
      dirty.set(decorations)
    },
    setExternalChanges(changes: readonly DirtyChange[] | undefined): void {
      const lineCount = model.getLineCount()
      external.set(
        (changes ?? []).map((change) => {
          const start = Math.min(Math.max(change.fromLine, 1), lineCount)
          const end = Math.min(Math.max(change.toLine, start), lineCount)
          const deleted = change.type === 'deleted'
          return {
            range: new monaco.Range(start, 1, end, 1),
            options: {
              isWholeLine: true,
              ...(deleted ? {} : { className: 'localix-monaco-external-line' }),
              linesDecorationsClassName: deleted
                ? 'localix-monaco-external-deleted'
                : 'localix-monaco-external-gutter',
              // Findable from the scrollbar in a long file — the change may be off-screen.
              overviewRuler: {
                color: deleted ? '#f85149' : '#3fb950',
                position: monaco.editor.OverviewRulerLane.Full,
              },
            },
          }
        }),
      )
    },
    setComments(ranges: CommentedRange[] | undefined): void {
      comments.set(
        (ranges ?? []).map((range) => {
          const start = Math.min(Math.max(range.line + 1, 1), model.getLineCount())
          const end = Math.min(Math.max(range.endLine + 1, start), model.getLineCount())
          return {
            range: new monaco.Range(start, 1, end, model.getLineMaxColumn(end)),
            options: {
              isWholeLine: true,
              className: 'localix-monaco-commented-line',
              glyphMarginClassName: 'localix-monaco-comment-glyph',
              glyphMarginHoverMessage: range.body ? { value: range.body } : undefined,
            },
          }
        }),
      )
    },
    async setBlameSource(source: InlineBlameSource | undefined): Promise<void> {
      currentBlameSource = source
      await loadBlame(source)
    },
    flashLine(lineNumber: number): void {
      const line = Math.min(Math.max(lineNumber, 1), model.getLineCount())
      flash.set([
        {
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: 'localix-monaco-flash-line' },
        },
      ])
      setTimeout(() => flash.clear(), 4200)
    },
    dispose(): void {
      disposed = true
      blameAbort?.abort()
      if (blameTimer) clearTimeout(blameTimer)
      if (blameReloadTimer) clearTimeout(blameReloadTimer)
      cursorDisposable.dispose()
      contentDisposable.dispose()
      dirty.clear()
      external.clear()
      comments.clear()
      blame.dispose()
      flash.clear()
      monaco.editor.setModelMarkers(model, markerOwner, [])
    },
  }
}
