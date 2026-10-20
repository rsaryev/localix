import { describe, expect, test } from 'bun:test'

import { createPiScriptSandbox } from './scripts'

/**
 * The engine's script port on the real QuickJS sandbox: the script reaches its tools and nothing
 * else, independent calls overlap, and every way a script can end is a result rather
 * than a rejection.
 */
const sandbox = createPiScriptSandbox()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const read = {
  name: 'read',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  execute: async (input: unknown) => {
    await sleep(150)
    return `contents of ${(input as { path: string }).path}`
  },
}

describe('the pi script sandbox', () => {
  test('runs independent calls in parallel and returns only what the script outputs', async () => {
    const started = performance.now()
    const result = await sandbox.run({
      code: `
        const [a, b] = await Promise.all([tools.read({ path: 'a.ts' }), tools.read({ path: 'b.ts' })])
        text(a)
        return b.length
      `,
      tools: [read],
      timeoutMs: 10_000,
    })
    expect(performance.now() - started).toBeLessThan(290)
    expect(result).toMatchObject({
      ok: true,
      value: 'contents of b.ts'.length,
      output: [{ type: 'text', text: 'contents of a.ts' }],
    })
  })

  test('has no capability beyond its tools, and reports a failing tool to the script', async () => {
    const result = await sandbox.run({
      code: `
        const missing = [typeof fetch, typeof require, typeof process, typeof setTimeout]
        try { await tools.boom({}) } catch (error) { text('caught: ' + error.message) }
        return missing
      `,
      tools: [
        {
          name: 'boom',
          description: 'fails',
          inputSchema: { type: 'object' },
          execute: async () => {
            throw new Error('the tool refused')
          },
        },
      ],
      timeoutMs: 10_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: ['undefined', 'undefined', 'undefined', 'undefined'],
      output: [{ type: 'text', text: 'caught: the tool refused' }],
    })
  })

  test('a throw, a deadline and an abort are results, not rejections', async () => {
    const thrown = await sandbox.run({
      code: `throw new Error('nope')`,
      tools: [],
      timeoutMs: 5_000,
    })
    expect(thrown).toMatchObject({ ok: false, error: { message: 'nope' } })

    const slow = await sandbox.run({ code: `while (true) {}`, tools: [], timeoutMs: 200 })
    expect(slow).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('timed out') },
    })

    const controller = new AbortController()
    const pending = sandbox.run({
      code: `await tools.read({ path: 'x' }); return 1`,
      tools: [read],
      timeoutMs: 10_000,
      signal: controller.signal,
    })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false })
  })

  test('declares each tool as a typed call that resolves to its text', () => {
    const declared = sandbox.declare([read])
    expect(declared).toContain('Read a file')
    expect(declared).toContain('read(')
    expect(declared).toContain('Promise<string>')
  })
})
