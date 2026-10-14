import type { MonacoEditorExtension } from '@localixai/kit/code-editor'
import { statementAt, splitStatements } from '../../shared/sql-statements'

function trimSpan(text: string, from: number, to: number): { from: number; to: number } | null {
  let start = from
  let end = to
  while (start < end && /\s/.test(text[start]!)) start++
  while (end > start && /\s/.test(text[end - 1]!)) end--
  return end > start ? { from: start, to: end } : null
}

/** Active-statement band for multi-statement SQL buffers. */
export function sqlStatementHighlight(): MonacoEditorExtension {
  return {
    setup({ monaco, editor, model }) {
      const decorationCollection = editor.createDecorationsCollection()
      const render = () => {
        const text = model.getValue()
        const position = editor.getPosition()
        if (!position || splitStatements(text).length <= 1) {
          decorationCollection.clear()
          return
        }
        const raw = statementAt(text, model.getOffsetAt(position))
        const span = raw ? trimSpan(text, raw.from, raw.to) : null
        if (!span) {
          decorationCollection.clear()
          return
        }
        const startLine = model.getPositionAt(span.from).lineNumber
        const endLine = model.getPositionAt(span.to).lineNumber
        decorationCollection.set(
          Array.from({ length: endLine - startLine + 1 }, (_, index) => {
            const line = startLine + index
            const edge =
              startLine === endLine
                ? ' monaco-sql-statement-first monaco-sql-statement-last'
                : line === startLine
                  ? ' monaco-sql-statement-first'
                  : line === endLine
                    ? ' monaco-sql-statement-last'
                    : ''
            return {
              range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
              options: {
                isWholeLine: true,
                className: `monaco-sql-statement${edge}`,
                linesDecorationsClassName: 'monaco-sql-statement-gutter',
              },
            }
          }),
        )
      }
      const cursor = editor.onDidChangeCursorPosition(render)
      const content = model.onDidChangeContent(render)
      render()
      return {
        dispose() {
          cursor.dispose()
          content.dispose()
          decorationCollection.clear()
        },
      }
    },
  }
}
