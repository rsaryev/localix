import type { EditorTextSelection } from '@/shared/ui/code-editor/CodeEditor'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'

export interface FileSelectionContextInput extends EditorTextSelection {
  path: string
  language?: string
}

export function fileSelectionLabel(path: string, startLine: number, endLine: number): string {
  const lines = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
  return `${baseName(path)} ${lines}`
}

/** Canonical live binding for exactly the selected editor text and no surrounding file content. */
export function fileSelectionMessageBinding(input: FileSelectionContextInput) {
  const label = fileSelectionLabel(input.path, input.startLine, input.endLine)
  return {
    kind: 'context',
    source: 'active-tab',
    target: {
      kind: 'snippet',
      token: `@snippet:${label}`,
      label,
      attributes: {
        content: input.text,
        path: input.path,
        ...(input.language ? { language: input.language } : {}),
        startLine: input.startLine,
        startColumn: input.startColumn,
        endLine: input.endLine,
        endColumn: input.endColumn,
        selection: true,
      },
    },
  } as const
}
