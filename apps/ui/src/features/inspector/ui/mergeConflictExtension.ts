import type * as Monaco from 'monaco-editor'
import type { MonacoEditorExtension } from '@/shared/ui/code-editor/monaco/extensions'
import { parseMergeConflicts } from '../model/mergeConflicts'

/** Editor-native conflict coloring that follows the live model as blocks are resolved. */
export const mergeConflictExtension: MonacoEditorExtension = {
  setup({ monaco, editor, model }) {
    const decorations = editor.createDecorationsCollection()
    const render = () => {
      const rows: Monaco.editor.IModelDeltaDecoration[] = []
      for (const region of parseMergeConflicts(model.getValue())) {
        rows.push({
          range: new monaco.Range(region.startLine, 1, region.startLine, 1),
          options: {
            isWholeLine: true,
            className: 'localix-monaco-conflict-marker',
            linesDecorationsClassName: 'localix-monaco-conflict-gutter',
          },
        })
        rows.push({
          range: new monaco.Range(
            region.current.startLine,
            1,
            Math.max(region.current.startLine, region.current.endLine),
            1,
          ),
          options: { isWholeLine: true, className: 'localix-monaco-conflict-current' },
        })
        if (region.base) {
          rows.push({
            range: new monaco.Range(region.base.startLine - 1, 1, region.base.startLine - 1, 1),
            options: { isWholeLine: true, className: 'localix-monaco-conflict-marker' },
          })
          rows.push({
            range: new monaco.Range(
              region.base.startLine,
              1,
              Math.max(region.base.startLine, region.base.endLine),
              1,
            ),
            options: { isWholeLine: true, className: 'localix-monaco-conflict-base' },
          })
        }
        rows.push({
          range: new monaco.Range(
            region.incoming.startLine - 1,
            1,
            region.incoming.startLine - 1,
            1,
          ),
          options: { isWholeLine: true, className: 'localix-monaco-conflict-marker' },
        })
        rows.push({
          range: new monaco.Range(
            region.incoming.startLine,
            1,
            Math.max(region.incoming.startLine, region.incoming.endLine),
            1,
          ),
          options: { isWholeLine: true, className: 'localix-monaco-conflict-incoming' },
        })
        rows.push({
          range: new monaco.Range(region.endLine, 1, region.endLine, 1),
          options: { isWholeLine: true, className: 'localix-monaco-conflict-marker' },
        })
      }
      decorations.set(rows)
    }
    render()
    const content = model.onDidChangeContent(render)
    return {
      dispose() {
        content.dispose()
        decorations.clear()
      },
    }
  },
}
