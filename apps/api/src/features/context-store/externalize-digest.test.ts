import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { textEncoderByteLength } from '@localixai/agent'

import type { ContextStore } from './repository'
import { buildExternalizeAfterToolCall } from './externalize'

const store = {
  async putToolOutputArtifact() {},
  async indexToolOutput() {
    return { sections: 0, covered: 'full' }
  },
} as unknown as ContextStore

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, title: `row ${i}`, body: 'x'.repeat(80) }))

async function run(toolName: string, content: string) {
  dir = await mkdtemp(join(tmpdir(), 'json-digest-'))
  const hook = buildExternalizeAfterToolCall(store, {
    userId: 'u1',
    sessionId: 's1',
    sanitizeInput: (v) => v,
    spillDir: dir,
  })
  return hook(
    { toolCallId: 'call_9', toolName, input: {}, result: { content } },
    new AbortController().signal,
  )
}

describe('large JSON tool results', () => {
  const big = JSON.stringify({
    items: rows(2000),
    error: { message: 'upstream said no: rate limited' },
  })

  test('the model gets a digest with array lengths and a path to the whole result', async () => {
    expect(textEncoderByteLength(big)).toBeGreaterThan(190_000)
    const after = await run('mcp__crm__list_rows', big)
    const digest = JSON.parse(after!.content!)
    expect(digest.shape.fields.items.array).toBe(2000)
    expect(textEncoderByteLength(after!.content!)).toBeLessThan(20_000)
    // An error field survives the shrinking.
    expect(after!.content).toContain('upstream said no: rate limited')
    // The file holds the whole JSON.
    expect(JSON.parse(await readFile(digest.path, 'utf8'))).toEqual(JSON.parse(big))
    expect(digest.path.startsWith(dir!)).toBe(true)
  })

  test("small JSON, non-JSON text and file reads keep today's behaviour", async () => {
    expect(await run('mcp__crm__list_rows', JSON.stringify({ items: rows(5) }))).toBeUndefined()
    expect(await run('mcp__crm__dump', 'line of text\n'.repeat(20_000))).toBeUndefined()
    expect(await run('Read', big)).toBeUndefined()
  })
})
