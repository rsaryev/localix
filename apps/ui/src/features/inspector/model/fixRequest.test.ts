import { describe, expect, test } from 'bun:test'
import type { EditorDiagnostic } from '@/shared/ui/code-editor/types'
import { buildFixRequest } from './fixRequest'

const TEXT = [
  'type Authorize = () => Promise<string>;',
  'type StoreCredential = (credential: string) => Promise<void>;',
  'type ClearCredential = () => Promise<void>;',
  'type ValidateCredential = (credential: strixng) => Promise<string>;',
  '',
  '/**',
  ' * Owns the credential mutation lifecycle.',
].join('\n')

const typo: EditorDiagnostic = {
  line: 3,
  character: 39,
  endLine: 3,
  endCharacter: 46,
  severity: 'error',
  message: "Cannot find name 'strixng'. Did you mean 'string'?",
  source: 'ts',
  code: 2552,
}

describe('buildFixRequest', () => {
  const request = buildFixRequest({
    diagnostic: typo,
    path: '/work/grammar/src/background/credential-coordinator.ts',
    text: TEXT,
    language: 'typescript',
  })

  test('names the exact token location and the rule, as the Problems panel does', () => {
    expect(request).toContain(
      '`/work/grammar/src/background/credential-coordinator.ts:4:40` — ts(2552)',
    )
    expect(request).toContain("Cannot find name 'strixng'")
  })

  test('fences a numbered window in the file language with a caret under the span', () => {
    expect(request).toContain('```typescript\n')
    expect(request).toContain('1 | type Authorize = () => Promise<string>;')
    expect(request).toContain('4 | type ValidateCredential = (credential: strixng)')
    const caret = request.split('\n').find((line) => line.includes('^'))!
    // The carets sit exactly under `strixng`.
    const codeLine = request.split('\n').find((line) => line.startsWith('4 | '))!
    expect(codeLine.slice(caret.indexOf('^'), caret.lastIndexOf('^') + 1)).toBe('strixng')
  })

  test('keeps indentation instead of trimming it', () => {
    const indented = buildFixRequest({
      diagnostic: { ...typo, line: 1, character: 4, endLine: 1, endCharacter: 5 },
      path: '/a.ts',
      text: 'class A {\n    x: stirng\n}',
      language: 'typescript',
    })
    expect(indented).toContain('2 |     x: stirng')
  })

  test('lists other problems inside the window, but not hints or the diagnostic itself', () => {
    const other: EditorDiagnostic = {
      line: 1,
      character: 5,
      endLine: 1,
      endCharacter: 20,
      severity: 'warning',
      message: 'Unused type',
      source: 'ts',
      code: 6196,
    }
    const hint: EditorDiagnostic = { ...other, severity: 'hint', message: 'hint only' }
    const far: EditorDiagnostic = { ...other, line: 40, endLine: 40, message: 'far away' }
    const withNeighbours = buildFixRequest({
      diagnostic: typo,
      path: '/a.ts',
      text: TEXT,
      language: 'typescript',
      diagnostics: [typo, other, hint, far],
    })
    expect(withNeighbours).toContain('- line 2:6 warning ts(6196): Unused type')
    expect(withNeighbours).not.toContain('hint only')
    expect(withNeighbours).not.toContain('far away')
    expect(withNeighbours.match(/Cannot find name/g)).toHaveLength(1)
  })
})
