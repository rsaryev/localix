import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { candidatesOf, miniAppCandidates } from './ui-styles'

/**
 * A class the extractor misses is a utility the mini app never gets — no error, no warning, just an
 * element drawn unstyled. Each case below was cut in pieces by the first extractor, which split on
 * the punctuation that CSS functions and variant selectors are made of.
 */
describe('a mini app class is one candidate, whatever its value holds', () => {
  test.each([
    ['a CSS-variable shorthand', 'text-(--chart-2)'],
    ['a function with a comma in an arbitrary value', 'max-w-[min(26rem,100%)]'],
    ['a grid template', 'grid-cols-[minmax(0,1fr)_17rem]'],
    ['an attribute variant', 'data-[state=open]:flex'],
    ['a motion token', 'duration-(--dur-fast)'],
  ])('%s', (_label, className) => {
    expect(candidatesOf(`<div className="p-2 ${className} flex">`)).toContain(className)
    expect(candidatesOf(`cn('${className}', open && 'hidden')`)).toContain(className)
  })

  test('a class written next to code punctuation still yields the class itself', () => {
    expect(candidatesOf('<i class=flex>')).toContain('flex')
    expect(candidatesOf('toggle(hidden)')).toContain('hidden')
  })
})

test('compiles classes from provider UI folders without reading backend or output', async () => {
  const miniAppDir = await fs.mkdtemp(join(tmpdir(), 'localix-mini-app-styles-'))
  try {
    for (const dir of [
      'ui',
      'kubernetes/ui/ui',
      'kubernetes/ui/dist',
      'docker/ui',
      'kubernetes/backend',
      'dist/ui',
    ]) {
      await fs.mkdir(join(miniAppDir, dir), { recursive: true })
    }
    await fs.writeFile(join(miniAppDir, 'ui', 'register.tsx'), '<div className="flex" />')
    await fs.writeFile(
      join(miniAppDir, 'kubernetes/ui/ui', 'PodRow.tsx'),
      '<div className="grid-cols-[minmax(0,1fr)_7rem_4.75rem] @lg:grid-cols-6" />',
    )
    await fs.writeFile(join(miniAppDir, 'docker/ui', 'Row.tsx'), '<div className="grid-cols-4" />')
    await fs.writeFile(
      join(miniAppDir, 'kubernetes/backend', 'service.ts'),
      'const unused = "bg-red-500"',
    )
    await fs.writeFile(join(miniAppDir, 'dist/ui', 'entry.js'), 'const unused = "p-96"')
    await fs.writeFile(join(miniAppDir, 'kubernetes/ui/dist', 'entry.js'), 'const unused = "p-72"')

    const candidates = await miniAppCandidates(miniAppDir)
    expect(candidates).toContain('flex')
    expect(candidates).toContain('grid-cols-[minmax(0,1fr)_7rem_4.75rem]')
    expect(candidates).toContain('@lg:grid-cols-6')
    expect(candidates).toContain('grid-cols-4')
    expect(candidates).not.toContain('bg-red-500')
    expect(candidates).not.toContain('p-96')
    expect(candidates).not.toContain('p-72')
  } finally {
    await fs.rm(miniAppDir, { recursive: true, force: true })
  }
})
