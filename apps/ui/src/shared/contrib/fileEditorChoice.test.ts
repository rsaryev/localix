import { describe, expect, test } from 'bun:test'

import { choiceKeyFor } from './fileEditorChoice'

describe('file editor preference keys', () => {
  test('uses the ordinary final extension without plugin-specific knowledge', () => {
    expect(choiceKeyFor('/workspace/data.json')).toBe('json')
    expect(choiceKeyFor('/workspace/design.BOARD.JSON')).toBe('json')
  })

  test('keeps the ordinary extension behavior for other files', () => {
    expect(choiceKeyFor('/workspace/notes.markdown')).toBe('markdown')
    expect(choiceKeyFor('Dockerfile')).toBe('dockerfile')
  })
})
