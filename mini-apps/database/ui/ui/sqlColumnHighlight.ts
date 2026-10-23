import type { MonacoEditorExtension } from '@localixai/kit/code-editor'

/** Subtly tint plain identifiers that match a known schema column. */
export function sqlColumnHighlight(getColumns: () => ReadonlySet<string>): MonacoEditorExtension {
  return {
    setup({ monaco, editor, model }) {
      const decorationCollection = editor.createDecorationsCollection()
      const render = () => {
        const columns = getColumns()
        const decorations = []
        const regexp = /[A-Za-z_][A-Za-z0-9_]*/g
        for (const visibleRange of editor.getVisibleRanges()) {
          for (
            let line = visibleRange.startLineNumber;
            line <= visibleRange.endLineNumber;
            line++
          ) {
            const text = model.getLineContent(line)
            regexp.lastIndex = 0
            let match: RegExpExecArray | null
            while ((match = regexp.exec(text))) {
              if (!columns.has(match[0]!.toLowerCase())) continue
              decorations.push({
                range: new monaco.Range(
                  line,
                  match.index + 1,
                  line,
                  match.index + match[0]!.length + 1,
                ),
                options: { inlineClassName: 'monaco-sql-column' },
              })
            }
          }
        }
        decorationCollection.set(decorations)
      }
      const content = model.onDidChangeContent(render)
      const scroll = editor.onDidScrollChange(render)
      const layout = editor.onDidLayoutChange(render)
      render()
      return {
        dispose() {
          content.dispose()
          scroll.dispose()
          layout.dispose()
          decorationCollection.clear()
        },
      }
    },
  }
}
