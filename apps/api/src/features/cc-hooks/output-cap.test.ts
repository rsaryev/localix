/**
 * hooks.md, JSON output: `additionalContext`, `systemMessage` and plain stdout are capped at
 * 10,000 characters each; past that the text is saved to a file in the session directory and
 * replaced with the file's path and a preview of its first 2,000 characters.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHooksRuntime } from './run'

const dir = tempDirPerTest('cc-output-cap-')
const silent = { warn: () => {}, info: () => {} }

const make = (command: string) =>
  createCcHooksRuntime({
    registry: { SessionStart: [{ handlers: [{ source: 'plugin', command, timeoutMs: 5000 }] }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
    transcript: {
      path: join(dir(), 'transcript.jsonl'),
      agentPath: () => '',
      refresh: async () => {},
    } as never,
  })

describe('hook output past 10,000 characters', () => {
  it('a text of 10,000 characters is kept whole', async () => {
    const r = await make(`head -c 10000 /dev/zero | tr '\\0' 'a'`).runSessionStart('startup')
    expect(r.additionalContext).toHaveLength(10_000)
  })

  it('a longer one is saved to a file and replaced by its path and a 2,000-character preview', async () => {
    const r = await make(`head -c 12000 /dev/zero | tr '\\0' 'b'`).runSessionStart('startup')
    const text = r.additionalContext ?? ''
    expect(text.length).toBeLessThan(2_500)
    expect(text).toContain('b'.repeat(2_000))
    const path = text.match(/\/\S+\.txt/)?.[0] ?? ''
    expect(path.startsWith(dir())).toBe(true)
    expect(readFileSync(path, 'utf8')).toHaveLength(12_000)
  })
})
