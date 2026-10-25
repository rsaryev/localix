import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createSearchTool, prepareSearchArguments, searchToolInputSchema } from './search'

/** A call as the runtime makes it: prepared, validated, then run. */
async function run(dir: string, raw: Record<string, unknown>) {
  const tool = createSearchTool(undefined, dir)
  const input = searchToolInputSchema.parse(prepareSearchArguments(raw))
  return tool.execute('call', input)
}

describe('Claude Code Grep and Glob arguments', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-cc-'))
    await mkdir(path.join(dir, 'src'))
    await writeFile(path.join(dir, 'src/a.ts'), 'const Alpha = 1\nconst beta = 2\nALPHA again\n')
    await writeFile(path.join(dir, 'src/b.py'), 'alpha = 1\nbeta = 2\n')
    await writeFile(path.join(dir, 'notes.md'), 'alpha\nline two\nline three\n')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('pattern is the regex, and Claude Code’s default is the files that match', async () => {
    const result = await run(dir, { pattern: 'alpha' })
    expect(result.content).toContain('src/b.py')
    expect(result.content).toContain('notes.md')
    expect(result.content).not.toContain('= 1')
    expect(result.content).not.toMatch(/:\d+:/)
  })

  test('output_mode content shows lines; count shows matches per file', async () => {
    const content = await run(dir, { pattern: 'alpha', output_mode: 'content' })
    expect(content.content).toContain('alpha = 1')
    const count = await run(dir, { pattern: 'beta', output_mode: 'count' })
    expect(count.content).toContain('src/a.ts:1')
    expect(count.content).toContain('src/b.py:1')
  })

  test('-i makes the search case-insensitive', async () => {
    const exact = await run(dir, { pattern: 'alpha', output_mode: 'content', path: 'src/a.ts' })
    expect(exact.content).not.toContain('Alpha')
    const folded = await run(dir, {
      pattern: 'alpha',
      '-i': true,
      output_mode: 'content',
      path: 'src/a.ts',
    })
    expect(folded.content).toContain('Alpha')
    expect(folded.content).toContain('ALPHA')
  })

  test('-A, -B, -C and context print the lines around a hit', async () => {
    const after = await run(dir, {
      pattern: 'alpha',
      '-A': 1,
      output_mode: 'content',
      path: 'notes.md',
    })
    expect(after.content).toContain('line two')
    const around = await run(dir, {
      pattern: 'two',
      '-C': 1,
      output_mode: 'content',
      path: 'notes.md',
    })
    expect(around.content).toContain('alpha')
    expect(around.content).toContain('line three')
  })

  test('type narrows by language and head_limit caps the lines', async () => {
    const typed = await run(dir, { pattern: 'beta', type: 'py', output_mode: 'content' })
    expect(typed.content).toContain('b.py')
    expect(typed.content).not.toContain('a.ts')
    const capped = await run(dir, { pattern: 'a', output_mode: 'content', head_limit: 1 })
    expect(
      capped.content.split('\n').filter((l) => /:\d+:|^\s+\d/.test(l)).length,
    ).toBeLessThanOrEqual(1)
    expect(capped.content).toContain('head_limit')
  })

  test('multiline lets a pattern span lines', async () => {
    const result = await run(dir, {
      pattern: 'alpha\\nline two',
      multiline: true,
      output_mode: 'files_with_matches',
    })
    expect(result.content).toContain('notes.md')
    expect(result.content).not.toContain('b.py')
  })

  test('a pattern that is a glob, alone or with a path, lists files like Glob', async () => {
    const all = await run(dir, { pattern: '**/*.ts' })
    expect(all.content).toContain('src/a.ts')
    expect(all.content).not.toContain('b.py')
    const inSrc = await run(dir, { pattern: '*.py', path: 'src' })
    expect(inSrc.content).toContain('b.py')
  })

  test('a Grep-only key makes the pattern a regex even if it looks like a glob', () => {
    expect(prepareSearchArguments({ pattern: '*.ts', output_mode: 'content' })).toMatchObject({
      query: '*.ts',
    })
    expect(prepareSearchArguments({ pattern: 'foo.*bar' })).toMatchObject({ query: 'foo.*bar' })
  })

  test('keys it cannot honour are refused, and conflicting spellings too', () => {
    expect(() => prepareSearchArguments({ pattern: 'a', offset: 5 })).toThrow(/offset/)
    expect(() => prepareSearchArguments({ pattern: 'a', query: 'b' })).toThrow(/pattern/)
    expect(() =>
      prepareSearchArguments({ pattern: 'a', glob: '*.ts', path: 'x', unknown_key: 1 }),
    ).not.toThrow()
  })

  test('a native call keeps its content output', async () => {
    const result = await run(dir, { query: 'beta' })
    expect(result.content).toContain('beta = 2')
  })
})
