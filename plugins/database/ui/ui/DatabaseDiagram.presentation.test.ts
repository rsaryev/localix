import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('relationship diagram presentation', () => {
  test('the canvas paints no ground of its own', () => {
    // A pane-sized `bg-surface-raised` veil darkened the whole diagram against its neighbours.
    expect(read('./DatabaseDiagram.tsx')).not.toContain('bg-surface-raised')
  })

  test('status chips use the kit floating surface instead of a transcribed recipe', () => {
    const source = read('./DiagramStatusChips.tsx')
    expect(source).toContain("from '@localixai/kit/workbench-toolbar'")
    expect(source).toContain('FLOATING_SURFACE')
    expect(source).not.toContain('border-border-soft bg-background')
    expect(source).not.toContain('shadow-(--shadow-popover)')
  })

  test('the node header is a foreground veil, not the sunken raised token', () => {
    const source = read('./DiagramTableNode.tsx')
    expect(source).toContain('border-b border-border-soft bg-foreground/[0.04]')
    expect(source).not.toContain('bg-surface-raised/55')
  })
})
