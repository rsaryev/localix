import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSearchTool } from './search'
import { localEnvironment } from '../environments/local'
import type { ExecutionEnvironment } from '../environment'
import { MAX_BATCH_SEARCH_BYTES, MAX_SEARCH_QUERIES, searchQueries } from './search-batch'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-batch-'))
  await writeFile(path.join(dir, 'a.ts'), 'export const alpha = 1\nconst shared = 1\n')
  await writeFile(path.join(dir, 'b.ts'), 'export const beta = 2\nconst shared = 2\n')
})
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('search with several queries', () => {
  test('results come back grouped per query, in the order asked', async () => {
    const updates: unknown[] = []
    const result = await createSearchTool(undefined, dir).execute(
      'q1',
      { query: 'alpha', queries: ['beta', 'absent_zz'] },
      undefined,
      (details) => updates.push(details),
    )

    expect(result.isError).toBeUndefined()
    const sections = result.content.split('\n\n### ')
    expect(sections[0]).toStartWith('### "alpha"')
    expect(sections[0]).toContain('a.ts:1:export const alpha = 1')
    expect(sections[0]).not.toContain('beta')
    expect(sections[1]).toStartWith('"beta"')
    expect(sections[1]).toContain('b.ts:1:export const beta = 2')
    expect(sections[2]).toStartWith('"absent_zz"')
    expect(sections[2]).toContain('No matches for "absent_zz"')
    expect(updates).toEqual([result.details])
    expect(result.details?.queries?.map((row) => row.query)).toEqual(['alpha', 'beta', 'absent_zz'])
    expect(result.sources?.map((source) => path.basename(source.title ?? ''))).toEqual([
      'a.ts',
      'b.ts',
    ])
  })

  test('a single query still answers exactly as before — no sections', async () => {
    const result = await createSearchTool(undefined, dir).execute('q2', { queries: ['alpha'] })
    expect(result.content).not.toContain('### ')
    expect(result.content).toContain('a.ts:1')
    expect(result.details?.queries).toBeUndefined()
  })

  test('a bad query fails alone; the others still answer', async () => {
    const failing: ExecutionEnvironment = Object.assign(Object.create(localEnvironment), {
      async searchFiles(...args: Parameters<ExecutionEnvironment['searchFiles']>) {
        if (args[0] === 'boom') throw new Error('disk on fire')
        return localEnvironment.searchFiles(...args)
      },
    })
    const tool = createSearchTool(failing, dir)
    const result = await tool.execute('q3', { queries: ['boom', 'alpha'] })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Failed to run search: disk on fire')
    expect(result.content).toContain('a.ts:1')
    expect(result.details?.queries?.[0]?.isError).toBe(true)
  })

  test('more queries than one call runs are named back', async () => {
    const queries = Array.from({ length: MAX_SEARCH_QUERIES + 1 }, (_, i) => `q${i}_none`)
    const result = await createSearchTool(undefined, dir).execute('q4', { queries })
    expect(result.content).toContain('1 more not shown')
    expect(result.content).toContain(`"${queries.at(-1)}"`)
  })

  test('results past the text budget are not delivered, and run alone they arrive', async () => {
    // Every line matches every query, so each answer is a full-size search.
    const lines = Array.from({ length: 3_000 }, (_, i) => `row ${i} ${'x'.repeat(40)}`).join('\n')
    for (let f = 0; f < 4; f++) await writeFile(path.join(dir, `big${f}.txt`), lines)
    const tool = createSearchTool(undefined, dir)
    const queries = ['row', 'x+', 'ro+w', 'r.w', 'xx', 'w \\d']
    const result = await tool.execute('q5', { queries })

    expect(Buffer.byteLength(result.content)).toBeLessThan(MAX_BATCH_SEARCH_BYTES + 2_000)
    expect(result.content).toContain('more not shown')
    const skipped = result.details?.queries?.filter((row) => row.skipped) ?? []
    expect(skipped.length).toBeGreaterThan(0)
    // The skipped query, run alone next, delivers its hits.
    const again = await tool.execute('q6', { query: skipped[0]!.query })
    expect(again.content).toContain('row ')
  })

  test('a repeated batch delivers every query in full, changed or not', async () => {
    const tool = createSearchTool(undefined, dir)
    await tool.execute('d1', { queries: ['alpha', 'beta'] })
    await writeFile(path.join(dir, 'c.ts'), 'const beta = 3\n')
    const second = await tool.execute('d2', { queries: ['alpha', 'beta'] })
    const [alpha, beta] = second.content.split('\n\n### ')
    expect(alpha).toContain('a.ts')
    expect(beta).toContain('c.ts')
  })
})

describe('searchQueries', () => {
  test('`query` first, then `queries`, trimmed, blank and repeated ones dropped', () => {
    expect(searchQueries({ query: ' a ', queries: ['b', 'a', '  ', 'c'] })).toEqual(['a', 'b', 'c'])
    expect(searchQueries({})).toEqual([])
  })
})
