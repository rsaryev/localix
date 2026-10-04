import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SessionRecord } from '../repository'
import type { FileOpsContext } from './file-ops'
import { replaceContent, searchContent } from './file-ops'

let dir: string
const ctx = (): FileOpsContext => ({
  requireSession: async () => ({ id: 's1', executionBackend: 'local' }) as SessionRecord,
  resolveSessionWorkingDir: async () => dir,
})

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'file-search-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('content search and replace integration', () => {
  test('replace uses the same ignored-file scope as the confirmed search', async () => {
    mkdirSync(path.join(dir, '.git'))
    writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n')
    writeFileSync(path.join(dir, 'ignored.txt'), 'needle\n')

    const hiddenByDefault = await searchContent(ctx(), 'u', 's1', 'needle')
    const included = await searchContent(ctx(), 'u', 's1', 'needle', { includeIgnored: true })
    const replaced = await replaceContent(ctx(), 'u', 's1', 'needle', 'value', {
      includeIgnored: true,
    })

    expect(hiddenByDefault.matches).toEqual([])
    expect(included.matches.map((match) => match.path)).toEqual(['ignored.txt'])
    expect(replaced).toEqual({ filesChanged: 1, replacements: 1 })
    expect(readFileSync(path.join(dir, 'ignored.txt'), 'utf8')).toBe('value\n')
  })

  test('a malformed regex is an error, never a factual empty result', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'const value = 1\n')

    expect(searchContent(ctx(), 'u', 's1', '(', { regex: true })).rejects.toMatchObject({
      status: 400,
      code: 'content_search_failed',
    })
  })
})
