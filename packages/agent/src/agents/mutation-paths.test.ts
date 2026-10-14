import { describe, expect, test } from 'bun:test'

import { mutationInputPaths } from './mutation-paths'

describe('mutationInputPaths', () => {
  test('reads every shape a file mutation arrives in, deduplicated in first-seen order', () => {
    expect(mutationInputPaths({ path: 'a.ts', content: 'x' })).toEqual(['a.ts'])
    expect(mutationInputPaths({ file_path: '/w/a.ts' })).toEqual(['/w/a.ts'])
    expect(
      mutationInputPaths({
        edits: [{ path: 'a.ts' }, { file_path: 'b.ts' }, { path: 'a.ts' }],
      }),
    ).toEqual(['a.ts', 'b.ts'])
    expect(mutationInputPaths({ files: [{ path: 'x.md', content: '' }] })).toEqual(['x.md'])
    // MultiEdit: a shared file and edits without their own path.
    expect(mutationInputPaths({ file_path: 'm.ts', edits: [{ old_string: 'a' }] })).toEqual([
      'm.ts',
    ])
  })

  test('is total on partial and malformed input', () => {
    expect(mutationInputPaths(undefined)).toEqual([])
    expect(mutationInputPaths('text')).toEqual([])
    expect(mutationInputPaths({ edits: [null, 3, { path: '' }, { path: 'ok.ts' }] })).toEqual([
      'ok.ts',
    ])
    expect(mutationInputPaths({ files: 'not an array' })).toEqual([])
  })
})
