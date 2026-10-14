import { describe, expect, it } from 'bun:test'
import { classifyDiskChange, fsChangeTouchesFile } from './conflict-reconcile'

describe('classifyDiskChange', () => {
  it('is a no-op when the disk hash matches the loaded base', () => {
    expect(classifyDiskChange('h1', 'h1', false)).toBe('none')
    expect(classifyDiskChange('h1', 'h1', true)).toBe('none')
  })

  it('is a no-op when the disk hash is unknown (truncated / unreadable)', () => {
    expect(classifyDiskChange(null, 'h1', true)).toBe('none')
    expect(classifyDiskChange(undefined, 'h1', false)).toBe('none')
  })

  it('adopts silently when disk changed under a clean buffer', () => {
    expect(classifyDiskChange('h2', 'h1', false)).toBe('adopt')
  })

  it('raises a conflict when disk changed under a dirty buffer', () => {
    expect(classifyDiskChange('h2', 'h1', true)).toBe('conflict')
  })
})

describe('fsChangeTouchesFile', () => {
  const file = '/repo/src/features/app.ts'

  it('matches an empty (coarse reload-all) frame', () => {
    expect(fsChangeTouchesFile([], file)).toBe(true)
  })

  it("matches when the file's own directory changed", () => {
    expect(fsChangeTouchesFile(['/repo/src/features', '/other'], file)).toBe(true)
  })

  it('ignores changes in unrelated directories (incl. the parent)', () => {
    expect(fsChangeTouchesFile(['/repo/src', '/repo/src/features/nested'], file)).toBe(false)
  })
})
