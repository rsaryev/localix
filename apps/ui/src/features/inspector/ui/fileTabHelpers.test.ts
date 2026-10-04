import { describe, expect, mock, test } from 'bun:test'
import { saveBeforeFileAction, toEditorDiagnostic } from './fileTabHelpers'

describe('toEditorDiagnostic', () => {
  const range = { start: { line: 3, character: 8 }, end: { line: 3, character: 14 } }

  test('carries the Unnecessary / Deprecated tags the editor fades and strikes', () => {
    // The tag is what tells the editor to dim an unused declaration; dropping it here is
    // exactly how unused code used to look identical to used code.
    expect(toEditorDiagnostic({ range, message: 'unused', severity: 4, tags: [1] }).tags).toEqual([
      'unnecessary',
    ])
    expect(toEditorDiagnostic({ range, message: 'old', severity: 4, tags: [2, 1] }).tags).toEqual([
      'deprecated',
      'unnecessary',
    ])
  })

  test('an untagged diagnostic has no tags field', () => {
    expect('tags' in toEditorDiagnostic({ range, message: 'x', severity: 1 })).toBe(false)
  })
})

describe('saveBeforeFileAction', () => {
  test('does not invoke save for a clean editor', async () => {
    const save = mock(async () => false)

    expect(await saveBeforeFileAction(false, save)).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  test('propagates a dirty editor save outcome', async () => {
    const failed = mock(async () => false)
    const succeeded = mock(async () => true)

    expect(await saveBeforeFileAction(true, failed)).toBe(false)
    expect(await saveBeforeFileAction(true, succeeded)).toBe(true)
    expect(failed).toHaveBeenCalledTimes(1)
    expect(succeeded).toHaveBeenCalledTimes(1)
  })
})
