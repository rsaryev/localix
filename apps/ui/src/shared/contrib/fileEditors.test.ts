import { describe, expect, test } from 'bun:test'

import { fileEditorById, fileEditorsFor, registerFileEditor } from './fileEditors'
import type { FileEditorContribution } from './fileEditors'

const stub = (id: string, ext: string): FileEditorContribution => ({
  id,
  label: id,
  match: (p) => p.endsWith(`.${ext}`),
  Component: (() => null) as FileEditorContribution['Component'],
})

describe('fileEditors multi-match registry', () => {
  test('every matching contribution is returned, in registration order', () => {
    registerFileEditor(stub('a.first', 'multi'))
    registerFileEditor(stub('b.second', 'multi'))
    const matches = fileEditorsFor('report.multi')
    expect(matches.map((m) => m.id)).toEqual(['a.first', 'b.second'])
  })

  test('non-matching keys return an empty list (built-in fallback path)', () => {
    expect(fileEditorsFor('plain.unmatched-ext')).toEqual([])
  })

  test('contributions resolve by stable id (the remembered "open with" choice)', () => {
    // Register here rather than leaning on the first test having run: the registry is
    // module state and `bun test --randomize` does not guarantee declaration order.
    // Its OWN id and extension — reusing the first test's `a.first` would have put a
    // second entry in the shared registry and broken that test when this one ran first.
    registerFileEditor(stub('c.by-id', 'by-id'))
    expect(fileEditorById('c.by-id')?.label).toBe('c.by-id')
    expect(fileEditorById('missing.plugin')).toBeUndefined()
  })
})
