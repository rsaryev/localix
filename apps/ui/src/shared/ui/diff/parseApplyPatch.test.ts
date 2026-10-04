import { describe, expect, test } from 'bun:test'

import { parseApplyPatch } from './parseApplyPatch'

describe('parseApplyPatch', () => {
  test('splits a full multi-file patch into per-file segments, dropping the envelope/@@ markers', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@ class A',
      ' ctx',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+line 1',
      '+line 2',
      '*** Delete File: src/c.ts',
      '*** End Patch',
    ].join('\n')
    const files = parseApplyPatch(patch)
    expect(files.map((f) => `${f.path}:${f.kind}`)).toEqual([
      'src/a.ts:modify',
      'src/b.ts:add',
      'src/c.ts:delete',
    ])
    // Envelope + @@ markers stripped; only +/-/context body remains.
    expect(files[0].body).toBe(' ctx\n-old\n+new')
    expect(files[1].body).toBe('+line 1\n+line 2')
    expect(files[2].body).toBe('')
  })

  test('`*** Move to:` retargets the current file as a rename, not a new segment', () => {
    const patch = '*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n+x'
    const files = parseApplyPatch(patch)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'src/new.ts', kind: 'rename', body: '+x' })
  })

  test('tolerates a half-streamed tail: only complete headers become segments', () => {
    const partial = '*** Begin Patch\n*** Update File: src/a.ts\n+done\n*** Update Fi'
    const files = parseApplyPatch(partial)
    expect(files.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(files[0].body).toBe('+done')
  })

  test('empty / non-patch input yields no segments', () => {
    expect(parseApplyPatch('')).toEqual([])
    expect(parseApplyPatch('just some text\nnot a patch')).toEqual([])
  })
})
