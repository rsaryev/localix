import { FileText } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

function fileName(path: string): string {
  return path.split('/').findLast(Boolean) ?? path
}

const position = (description: string) =>
  ({
    type: 'integer',
    description,
    optional: true,
    minimum: 1,
    maximum: 10_000_000,
  }) as const

export default defineUiLocation({
  id: 'file.open',
  uri: 'localix://ui/work-item/file',
  title: 'File',
  description: 'Open a workspace file',
  agent: {
    description:
      'Open a workspace file for the person, optionally at a line — or selecting an exact span ' +
      '(line+column to end_line+end_column, all 1-based) to show them precisely what you mean.',
  },
  keywords: ['editor', 'source', 'code'],
  group: 'Navigation',
  Icon: FileText,
  effect: 'read',
  surface: 'work-item',
  params: {
    path: {
      type: 'string',
      description: 'Workspace-relative or absolute file path from trusted tool context.',
      maxLength: 1_024,
    },
    line: position('Optional one-based line number to reveal.'),
    column: position('Optional one-based column on `line` where the caret or selection starts.'),
    // snake_case, not camelCase: a param key is a URL query key, and the location contract admits
    // only `[a-z][a-z0-9_-]*` — `endLine` failed it and took the whole surface catalog down at
    // startup ("invalid or colliding metadata for file.open").
    end_line: position('Optional one-based last line of a span to select.'),
    end_column: position('Optional one-based column on `end_line` where the selection ends.'),
  },
  exposure: { search: false, palette: false },
  present: ({ path, line, end_line: endLine }) => ({
    label: `Open ${fileName(path)}`,
    ...(line
      ? {
          description:
            endLine && endLine !== line ? `Select lines ${line}–${endLine}` : `Reveal line ${line}`,
        }
      : {}),
  }),
  resolve: ({ path, line, column, end_line: endLine, end_column: endColumn }) => ({
    kind: 'file',
    path,
    ...(line ? { line } : {}),
    ...(line && column ? { column } : {}),
    ...(line && endLine ? { endLine } : {}),
    ...(line && endLine && endColumn ? { endColumn } : {}),
  }),
})
