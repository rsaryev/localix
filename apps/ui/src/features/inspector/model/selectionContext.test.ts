import { describe, expect, test } from 'bun:test'
import { fileSelectionLabel, fileSelectionMessageBinding } from './selectionContext'

describe('file selection message context', () => {
  test('labels single- and multi-line selections with the file name and line range', () => {
    expect(fileSelectionLabel('/workspace/src/foo.ts', 12, 18)).toBe('foo.ts L12-L18')
    expect(fileSelectionLabel('/workspace/src/foo.ts', 12, 12)).toBe('foo.ts L12')
  })

  test('binds exact content and complete 1-based selection metadata', () => {
    const binding = fileSelectionMessageBinding({
      text: 'const answer = 42',
      path: '/workspace/src/foo.ts',
      language: 'typescript',
      startLine: 12,
      startColumn: 3,
      endLine: 12,
      endColumn: 20,
    })

    expect(binding).toEqual({
      kind: 'context',
      source: 'active-tab',
      target: {
        kind: 'snippet',
        token: '@snippet:foo.ts L12',
        label: 'foo.ts L12',
        attributes: {
          content: 'const answer = 42',
          path: '/workspace/src/foo.ts',
          language: 'typescript',
          startLine: 12,
          startColumn: 3,
          endLine: 12,
          endColumn: 20,
          selection: true,
        },
      },
    })
  })
})
