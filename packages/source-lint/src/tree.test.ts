import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { EmptyScanError, isSourceFile, sourceTree, walkSources } from './tree'

const fixture = mkdtempSync(join(tmpdir(), 'source-lint-tree-'))
afterAll(() => rmSync(fixture, { recursive: true, force: true }))

mkdirSync(join(fixture, 'providers', 'acme', 'wire'), { recursive: true })
mkdirSync(join(fixture, 'node_modules', 'junk'), { recursive: true })
writeFileSync(join(fixture, 'providers', 'acme', 'llm.mjs'), 'export const a = 1\n')
// One folder DOWN — the file the old one-level walkers never opened.
writeFileSync(join(fixture, 'providers', 'acme', 'wire', 'sse.mjs'), 'export const b = 2\n')
writeFileSync(join(fixture, 'providers', 'acme', 'wire.test.mjs'), 'export const c = 3\n')
writeFileSync(join(fixture, 'node_modules', 'junk', 'index.ts'), 'export const d = 4\n')

const seen = () =>
  walkSources(fixture)
    .map((f) => relative(fixture, f))
    .sort()

describe('walkSources', () => {
  test('recurses — a wire one folder down is found', () => {
    expect(seen()).toContain(join('providers', 'acme', 'wire', 'sse.mjs'))
  })

  test('skips test files and node_modules', () => {
    expect(seen()).toEqual([
      join('providers', 'acme', 'llm.mjs'),
      join('providers', 'acme', 'wire', 'sse.mjs'),
    ])
  })

  test('a missing root is empty, not an error — which is exactly why sourceTree exists', () => {
    expect(walkSources(join(fixture, 'nope'))).toEqual([])
  })
})

describe('isSourceFile', () => {
  test('source yes, test no', () => {
    expect(isSourceFile('wire.mjs')).toBe(true)
    expect(isSourceFile('ChartCanvas.tsx')).toBe(true)
    expect(isSourceFile('wire.test.mjs')).toBe(false) // .test.* is never source
    expect(isSourceFile('plugin.json')).toBe(false)
  })
})

describe('sourceTree: the anti-void assertion', () => {
  test('returns the files when the witnesses are there', () => {
    const files = sourceTree({
      roots: [fixture],
      mustInclude: [join('wire', 'sse.mjs')],
      minFiles: 2,
    })
    expect(files.length).toBe(2)
  })

  test('THROWS when the subject moved — the lint goes red instead of scanning air', () => {
    expect(() =>
      sourceTree({ roots: [fixture], mustInclude: ['anthropic/wire.mjs'], label: 'the wires' }),
    ).toThrow(EmptyScanError)
  })

  test('THROWS when the root is gone — an empty scan is not a clean tree', () => {
    expect(() => sourceTree({ roots: [join(fixture, 'moved-away')], minFiles: 1 })).toThrow(
      EmptyScanError,
    )
  })

  test('the failure names the roots it walked, so the fix is obvious', () => {
    try {
      sourceTree({ roots: [join(fixture, 'moved-away')], label: 'the provider wires' })
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('the provider wires')
      expect((err as Error).message).toContain('fails OPEN')
    }
  })
})
