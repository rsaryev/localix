import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const readSource = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('live editor change status', () => {
  test('uses shared slim editor toolbars instead of floating status badges', () => {
    const fileTab = readSource('LiveFileChangeTab.tsx')
    const patch = readSource('LivePatchDiff.tsx')
    const sources = [fileTab, patch].join('\n')

    expect(fileTab.match(/<WorkbenchToolbar(?=[\s>])/g)).toHaveLength(1)
    expect(fileTab).toContain('density="slim"')
    expect(fileTab).toContain('aria-label="Live file change status"')
    // The live patch renders through VirtualDiff, whose DiffToolbar is the shared slim bar;
    // the stream status rides its lead slot instead of a second, hand-built toolbar.
    expect(patch).toContain('<VirtualDiff')
    expect(patch).toMatch(/lead=\{<ActivitySignal/)
    expect(patch).not.toContain('<WorkbenchToolbar')
    expect(sources).not.toContain('h-7 shrink-0 items-center')
    expect(sources).toContain('<ActivitySignal')
    expect(sources).not.toContain('bg-surface-raised/85')
    expect(sources).not.toContain('backdrop-blur')
    expect(sources).not.toContain('<ActivityOrb')
  })

  test('renders patch-kind metadata without a badge fill', () => {
    const source = readSource('LivePatchDiff.tsx')

    expect(source).not.toContain('rounded bg-surface-active')
  })
})
