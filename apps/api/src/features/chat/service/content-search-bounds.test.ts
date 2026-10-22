import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { searchContent } from './file-ops'
import type { FileOpsContext } from './file-ops'
import type { SessionRecord } from '../repository'
import { localEnvironment } from '../../agent-core/tools/environments/local'

/**
 * The inspector's Search panel keeps at most `limit` matches, but `rg --json` was
 * asked for every match in the tree and the answer was cut to size afterwards — by
 * the exec capture cap, which keeps the TAIL. These pin that the stream is bounded
 * at the source instead, without breaking the ordinary small-result paths.
 */

let dir: string
const ctx = (): FileOpsContext => ({
  requireSession: async () => ({ id: 's1', executionBackend: 'local' }) as unknown as SessionRecord,
  resolveSessionWorkingDir: async () => dir,
})

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'contentsearch-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// Each search spawns ripgrep: the file takes a few hundred milliseconds alone, but a pre-push run
// that tests every package at once has stretched one past Bun's 5-second default.
const SPAWNS_RIPGREP_MS = 20_000

describe('searchContent bounds', () => {
  test(
    'does not pull the whole match set out of the environment to keep a page of it',
    async () => {
      // ~8000 matches. Unbounded, `rg --json` emits an event per match and the exec
      // capture then trims what it cannot hold — so the panel paid for the entire
      // result set to display 25 rows of it.
      for (let f = 0; f < 40; f++) {
        const lines = Array.from({ length: 200 }, (_, i) => `const needleToken_${f}_${i} = ${i}`)
        writeFileSync(path.join(dir, `file-${f}.ts`), lines.join('\n'))
      }

      let captured = 0
      const real = localEnvironment.exec.bind(localEnvironment)
      const exec = spyOn(localEnvironment, 'exec').mockImplementation(async (cmd, opts) => {
        const res = await real(cmd, opts)
        captured += res.stdout.length
        return res
      })

      try {
        const res = await searchContent(ctx(), 'u', 's1', 'needleToken', { limit: 25 })
        expect(res.matches.length).toBe(25)
        // 25 matches need a few KB. Unbounded this run transfers megabytes.
        expect(captured).toBeLessThan(200_000)
      } finally {
        exec.mockRestore()
      }
    },
    SPAWNS_RIPGREP_MS,
  )

  test(
    'a query with far more hits than the limit returns exactly the limit, flagged',
    async () => {
      for (let f = 0; f < 40; f++) {
        const lines = Array.from({ length: 200 }, (_, i) => `const needleToken_${f}_${i} = ${i}`)
        writeFileSync(path.join(dir, `file-${f}.ts`), lines.join('\n'))
      }

      const res = await searchContent(ctx(), 'u', 's1', 'needleToken', { limit: 25 })

      expect(res.matches.length).toBe(25)
      expect(res.count).toBe(25)
      expect(res.truncated).toBe(true)
      // Every returned match is a REAL, fully-parsed record — the tail slice used to
      // begin mid-object, and that partial line was silently dropped.
      for (const m of res.matches) {
        expect(m.path).toMatch(/^file-\d+\.ts$/)
        expect(m.line).toBeGreaterThan(0)
        expect(m.lineText).toContain('needleToken')
      }
    },
    SPAWNS_RIPGREP_MS,
  )

  test(
    'a result set under the limit is complete and not flagged',
    async () => {
      writeFileSync(path.join(dir, 'a.ts'), 'alpha\nbeta\nalpha again\n')
      writeFileSync(path.join(dir, 'b.ts'), 'nothing here\n')

      const res = await searchContent(ctx(), 'u', 's1', 'alpha', { limit: 300 })

      expect(res.count).toBe(2)
      expect(res.truncated).toBe(false)
      expect(res.matches.map((m) => m.line)).toEqual([1, 3])
    },
    SPAWNS_RIPGREP_MS,
  )

  test(
    'no matches is still an empty, untruncated answer',
    async () => {
      writeFileSync(path.join(dir, 'a.ts'), 'alpha\n')

      const res = await searchContent(ctx(), 'u', 's1', 'zzz-absent-zzz')

      expect(res.matches).toEqual([])
      expect(res.count).toBe(0)
      expect(res.truncated).toBe(false)
    },
    SPAWNS_RIPGREP_MS,
  )

  test(
    "ripgrep's own failure still surfaces — the pipe must not swallow it",
    async () => {
      writeFileSync(path.join(dir, 'a.ts'), 'alpha\n')

      // An unterminated character class: ripgrep exits 2. The pipeline's status is
      // `head`'s (0), so this only fails loudly if rg's code is routed out of band.
      expect(searchContent(ctx(), 'u', 's1', '[unclosed', { regex: true })).rejects.toThrow()
    },
    SPAWNS_RIPGREP_MS,
  )

  test(
    'context lines are still attached to the bounded stream',
    async () => {
      writeFileSync(path.join(dir, 'a.ts'), 'one\ntwo\nneedle\nfour\nfive\n')

      const res = await searchContent(ctx(), 'u', 's1', 'needle', { contextLines: 1 })

      expect(res.matches.length).toBe(1)
      expect(res.matches[0]?.line).toBe(3)
      // The line budget has to leave room for context events, or they vanish.
      expect(res.matches[0]?.before).toEqual(['two'])
      expect(res.matches[0]?.after).toEqual(['four'])
    },
    SPAWNS_RIPGREP_MS,
  )
})
