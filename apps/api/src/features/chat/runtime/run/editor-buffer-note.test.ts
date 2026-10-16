import { describe, expect, test } from 'bun:test'
import { editorBufferNote } from './editor-buffer-note'

describe("editorBufferNote — the person's unsaved edits, seen from a file tool", () => {
  test('no open buffer, or one that matches disk, says nothing', () => {
    expect(editorBufferNote('/w/a.ts', 'x\n', undefined, 'read')).toBe('')
    expect(editorBufferNote('/w/a.ts', 'x\n', 'x\n', 'write')).toBe('')
  })

  test('a read names the unsaved lines the disk text lacks, as a diff', () => {
    const note = editorBufferNote('/w/a.ts', 'const a = 1\n', 'const a = 1\nconst b = 2\n', 'read')
    expect(note.startsWith('<editor_buffer>')).toBe(true)
    expect(note.endsWith('</editor_buffer>')).toBe(true)
    expect(note).toContain('UNSAVED edits')
    expect(note).toContain('does not include them')
    expect(note).toContain('+const b = 2')
    // Only hunks: the Index/---/+++ header is noise to the model.
    expect(note).not.toContain('Index:')
    expect(note).not.toContain('+++ editor')
  })

  test('a write warns that the change did not include them', () => {
    const note = editorBufferNote('/w/a.ts', 'a\n', 'a\nb\n', 'write')
    expect(note).toContain('your change did not include')
    expect(note).toContain('reconcile')
  })

  test('a large divergence is clipped, and says so', () => {
    const disk = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const buffer = Array.from({ length: 200 }, (_, i) => `LINE ${i}`).join('\n')
    const note = editorBufferNote('/w/a.ts', disk, buffer, 'read')
    expect(note).toMatch(/… \d+ more diff lines/)
    expect(note.split('\n').length).toBeLessThan(60)
  })
})
