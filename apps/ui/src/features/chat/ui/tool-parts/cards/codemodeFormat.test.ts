import { describe, expect, test } from 'bun:test'

import {
  codemodeCallTarget,
  codemodeOutput,
  codemodeShape,
  codemodeSubtitle,
  codemodeTitle,
} from './codemodeFormat'

describe('codemode call shape', () => {
  test('reads the script from the input and each call from the details', () => {
    const shape = codemodeShape({
      input: { code: 'return await tools.read({ path: "a" })' },
      output: {
        calls: [
          { name: 'read', args: { path: 'a.ts' }, status: 'ok', durationMs: 12 },
          { name: 'bash', args: { command: 'false' }, status: 'error', error: 'exit 1' },
          { name: 'write', status: 'cancelled' },
          { name: 'bogus', status: 'exploded' },
          'not a call',
        ],
        complete: true,
      },
    })
    expect(shape.code).toBe('return await tools.read({ path: "a" })')
    expect(shape.calls).toEqual([
      { name: 'read', args: { path: 'a.ts' }, status: 'ok', durationMs: 12 },
      { name: 'bash', args: { command: 'false' }, status: 'error', error: 'exit 1' },
      { name: 'write', status: 'cancelled' },
    ])
    expect(codemodeTitle(shape)).toBe('Script · read, bash, write')
    expect(codemodeSubtitle(shape)).toBe('3 calls · 1 failed · 1 cancelled')
  })

  test('a running call, or one whose details are not loaded, still has a shape', () => {
    const shape = codemodeShape({ input: { code: 'text(1)' }, output: undefined })
    expect(shape).toEqual({ code: 'text(1)', calls: [], complete: true })
    expect(codemodeTitle(shape)).toBe('Script')
    expect(codemodeSubtitle(shape)).toBe('No tool calls')
  })

  test('a record that left calls out says so in the count', () => {
    const shape = codemodeShape({
      input: {},
      output: { calls: [{ name: 'read', status: 'ok' }], complete: false },
    })
    expect(codemodeSubtitle(shape)).toBe('1 call+')
  })

  test('names what each call was about: its files or its command', () => {
    expect(codemodeCallTarget({ name: 'read', status: 'ok', args: { path: 'a.ts' } })).toEqual({
      paths: ['a.ts'],
    })
    expect(
      codemodeCallTarget({
        name: 'write',
        status: 'ok',
        args: { files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
      }),
    ).toEqual({ paths: ['a.ts', 'b.ts'] })
    expect(
      codemodeCallTarget({ name: 'edit', status: 'ok', args: { edits: [{ path: 'c.ts' }] } }),
    ).toEqual({ paths: ['c.ts'] })
    expect(codemodeCallTarget({ name: 'bash', status: 'ok', args: { command: 'ls -la' } })).toEqual(
      { command: 'ls -la' },
    )
    expect(codemodeCallTarget({ name: 'read', status: 'ok' })).toBeUndefined()
  })

  test('indents a JSON report and leaves any other text as it is', () => {
    expect(codemodeOutput('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(codemodeOutput('3 files')).toBe('3 files')
    expect(codemodeOutput('{not json')).toBe('{not json')
  })
})
