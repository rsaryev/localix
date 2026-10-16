import { describe, expect, test } from 'bun:test'

import { mutationTargets, prepareEditArguments, prepareWriteArguments } from './mutation-input'

describe('prepareEditArguments', () => {
  test('the batch shape passes through untouched', () => {
    const input = { edits: [{ path: 'a.ts', old_string: 'a', new_string: 'b' }], cwd: '/w' }
    expect(prepareEditArguments(input)).toBe(input)
  })

  test("Localix's previous single-edit shape becomes a one-edit batch", () => {
    expect(
      prepareEditArguments({
        path: 'a.ts',
        old_string: 'a',
        new_string: 'b',
        replace_all: true,
        cwd: '/w',
      }),
    ).toEqual({
      cwd: '/w',
      edits: [{ path: 'a.ts', old_string: 'a', new_string: 'b', replace_all: true }],
    })
  })

  test("Claude Code's Edit (`file_path`) is lifted the same way", () => {
    expect(
      prepareEditArguments({ file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }),
    ).toEqual({ edits: [{ path: '/w/a.ts', old_string: 'a', new_string: 'b' }] })
  })

  test("Claude Code's MultiEdit gives every edit the shared file, keeping their order", () => {
    expect(
      prepareEditArguments({
        file_path: '/w/a.ts',
        edits: [
          { old_string: '1', new_string: '2' },
          { old_string: '2', new_string: '3', replace_all: true },
        ],
      }),
    ).toEqual({
      edits: [
        { path: '/w/a.ts', old_string: '1', new_string: '2' },
        { path: '/w/a.ts', old_string: '2', new_string: '3', replace_all: true },
      ],
    })
  })

  test('a per-edit `file_path` becomes its `path`; an own path beats the shared one', () => {
    expect(
      prepareEditArguments({
        path: 'shared.ts',
        edits: [
          { file_path: 'own.ts', old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toEqual({
      edits: [
        { path: 'own.ts', old_string: 'a', new_string: 'b' },
        { path: 'shared.ts', old_string: 'c', new_string: 'd' },
      ],
    })
  })

  test('anything unrecognised is returned as-is', () => {
    expect(prepareEditArguments('nope')).toBe('nope')
    const odd = { something: 1 }
    expect(prepareEditArguments(odd)).toBe(odd)
  })
})

describe('prepareWriteArguments', () => {
  test('the single-file shapes become a one-file batch', () => {
    expect(
      prepareWriteArguments({ path: 'a.ts', content: 'x', create_directories: false }),
    ).toEqual({ create_directories: false, files: [{ path: 'a.ts', content: 'x' }] })
    expect(prepareWriteArguments({ file_path: '/w/a.ts', content: 'x' })).toEqual({
      files: [{ path: '/w/a.ts', content: 'x' }],
    })
  })

  test('the batch shape passes through; a per-file `file_path` is renamed', () => {
    const input = { files: [{ path: 'a.ts', content: 'x' }] }
    expect(prepareWriteArguments(input)).toBe(input)
    expect(prepareWriteArguments({ files: [{ file_path: 'b.ts', content: 'y' }] })).toEqual({
      files: [{ path: 'b.ts', content: 'y' }],
    })
  })
})

describe('mutationTargets', () => {
  test('resolves every named file against the call cwd, deduplicated', () => {
    expect(
      mutationTargets(
        {
          cwd: 'sub',
          edits: [{ path: 'a.ts' }, { path: '/abs/b.ts' }, { path: './a.ts' }],
        },
        '/root',
      ),
    ).toEqual(['/root/sub/a.ts', '/abs/b.ts'])
    expect(mutationTargets({ files: [{ path: 'x.md' }] }, '/root')).toEqual(['/root/x.md'])
    expect(mutationTargets({ path: 'legacy.ts' }, '/root')).toEqual(['/root/legacy.ts'])
    expect(mutationTargets(undefined, '/root')).toEqual([])
  })
})
