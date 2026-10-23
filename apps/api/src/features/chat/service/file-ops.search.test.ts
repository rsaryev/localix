import { describe, expect, test } from 'bun:test'
import { deriveFolders, searchPaths } from './file-path-search'

const files = [
  'src/FileTab.tsx',
  'src/inspector/file-ops.ts',
  'src/inspector/QuickOpen.tsx',
  'README.md',
  'docs/guide.md',
  'src/a/b/c/deep-file.ts',
]

describe('deriveFolders', () => {
  test('collects every ancestor directory, deduped', () => {
    expect(deriveFolders(['a/b/c.ts', 'a/d.ts']).sort()).toEqual(['a', 'a/b'])
  })

  test('top-level files contribute no folder', () => {
    expect(deriveFolders(['README.md'])).toEqual([])
  })
})

describe('searchPaths', () => {
  test('fuzzy ranks the best basename match first and tags type', () => {
    const { files: hits, count } = searchPaths(files, 'filetab')
    expect(hits[0]?.path).toBe('src/FileTab.tsx')
    expect(hits[0]?.name).toBe('FileTab.tsx')
    expect(hits[0]?.type).toBe('file')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('type:folders surfaces directories only', () => {
    const { files: hits } = searchPaths(files, '', { type: 'folders' })
    expect(hits.every((h) => h.type === 'dir')).toBe(true)
    expect(hits.map((h) => h.path)).toContain('src/inspector')
  })

  test('type:files excludes directories', () => {
    const { files: hits } = searchPaths(files, '', { type: 'files' })
    expect(hits.every((h) => h.type === 'file')).toBe(true)
  })

  test('extension filter restricts to matching files', () => {
    const { files: hits } = searchPaths(files, '', { type: 'files', extensions: ['md'] })
    expect(hits.map((h) => h.path).sort()).toEqual(['README.md', 'docs/guide.md'])
  })

  test('extension filter tolerates a leading dot', () => {
    const { files: hits } = searchPaths(files, '', { type: 'files', extensions: ['.tsx'] })
    expect(hits.map((h) => h.path).sort()).toEqual([
      'src/FileTab.tsx',
      'src/inspector/QuickOpen.tsx',
    ])
  })

  test('regex mode filters by path pattern', () => {
    const { files: hits } = searchPaths(files, 'inspector/.*\\.tsx$', { mode: 'regex' })
    expect(hits.map((h) => h.path)).toEqual(['src/inspector/QuickOpen.tsx'])
  })

  test('leading-slash query is treated as regex regardless of mode', () => {
    const { files: hits } = searchPaths(files, '/\\.md$')
    expect(hits.map((h) => h.path).sort()).toEqual(['README.md', 'docs/guide.md'])
  })

  test('a malformed regex yields no results rather than throwing', () => {
    expect(searchPaths(files, '(', { mode: 'regex' })).toEqual({ files: [], count: 0 })
  })

  test('limit + offset paginate the ranked matches', () => {
    const all = searchPaths(files, '', { type: 'files' })
    const page1 = searchPaths(files, '', { type: 'files', limit: 2, offset: 0 })
    const page2 = searchPaths(files, '', { type: 'files', limit: 2, offset: 2 })
    expect(page1.count).toBe(all.count)
    expect(page1.files).toHaveLength(2)
    expect(page1.files.map((h) => h.path)).not.toEqual(page2.files.map((h) => h.path))
  })
})
