import { describe, expect, test } from 'bun:test'
import type { EditorDiagnostic } from '@/shared/ui/code-editor/types'
import { editorStateMessageBinding, editorStateText } from './editorStateContext'

const diag = (over: Partial<EditorDiagnostic>): EditorDiagnostic => ({
  line: 0,
  character: 0,
  endLine: 0,
  endCharacter: 1,
  severity: 'error',
  message: 'm',
  ...over,
})

describe('editor state facet', () => {
  test('names the caret line and the problems on screen, errors first', () => {
    const text = editorStateText({
      path: '/w/a.ts',
      cursorLine: 18,
      diagnostics: [
        diag({ line: 9, severity: 'warning', message: 'unused', source: 'ts', code: 6133 }),
        diag({ line: 3, character: 39, message: "Cannot find name 'x'", source: 'ts', code: 2304 }),
        diag({ line: 1, severity: 'hint', message: 'hint only' }),
      ],
    })!
    expect(text.split('\n')).toEqual([
      'Caret: /w/a.ts:18',
      'Problems (2):',
      "- 4:40 error ts(2304): Cannot find name 'x'",
      '- 10:1 warning ts(6133): unused',
    ])
  })

  test('says "none" when the server reports nothing, so silence is not mistaken for unknown', () => {
    expect(editorStateText({ path: '/w/a.ts', cursorLine: 1, diagnostics: [] })).toContain(
      'Problems: none',
    )
  })

  test('nothing to say before a caret or a problem exists', () => {
    expect(
      editorStateMessageBinding({ path: '/w/a.ts', cursorLine: null, diagnostics: [] }),
    ).toBeNull()
  })

  test('the binding carries the file path and caret line as its location', () => {
    const binding = editorStateMessageBinding({ path: '/w/a.ts', cursorLine: 7, diagnostics: [] })!
    expect(binding.target.kind).toBe('snippet')
    expect(binding.target.label).toBe('Editor · a.ts')
    expect(binding.target.attributes).toMatchObject({
      path: '/w/a.ts',
      startLine: 7,
      language: 'text',
    })
  })

  test('caps a long problem list', () => {
    const many = Array.from({ length: 30 }, (_, i) => diag({ line: i }))
    const text = editorStateText({ path: '/w/a.ts', cursorLine: 1, diagnostics: many })!
    expect(text).toContain('Problems (30):')
    expect(text).toContain('- … 10 more')
  })
})
