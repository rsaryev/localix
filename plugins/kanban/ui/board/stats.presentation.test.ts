import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./stats.tsx', import.meta.url), 'utf8')

describe('kanban statistics presentation', () => {
  test('renders metric detail collections as divided lists', () => {
    // The shared divided-list recipe, not a transcription of it.
    expect(source).toContain('className={DIVIDED_LIST}')
    expect(source).not.toContain('rounded-lg border border-border/40 px-3 py-2.5 text-left')
    expect(source).not.toContain('flex flex-col gap-1.5')
  })
})
