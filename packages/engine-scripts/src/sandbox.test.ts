import { describe, expect, test } from 'bun:test'

import type { ScriptTool } from '@localixai/agent/runtime'

import { createScriptSandbox } from './sandbox'

/**
 * The script port on the real QuickJS VM: a script reaches its tools and nothing else, independent
 * calls overlap, and every way a script can end is a result rather than a rejection.
 */
const sandbox = createScriptSandbox()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const read: ScriptTool = {
  name: 'read',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  execute: async (input) => {
    await sleep(0)
    return `contents of ${(input as { path: string }).path}`
  },
}

const run = (
  code: string,
  tools: ScriptTool[] = [read],
  timeoutMs = 10_000,
  signal?: AbortSignal,
) => sandbox.run({ code, tools, timeoutMs, ...(signal ? { signal } : {}) })

describe('the script sandbox', () => {
  test('runs independent calls in parallel and returns only what the script outputs', async () => {
    // Overlap, not wall time: starting the worker is no part of what this pins.
    const events: string[] = []
    const tracked: ScriptTool = {
      ...read,
      execute: async (input, signal) => {
        events.push('start')
        const value = await read.execute(input, signal)
        events.push('end')
        return value
      },
    }
    const result = await run(
      `
      const [a, b] = await Promise.allSettled([tools.read({ path: 'a.ts' }), tools.read({ path: 'b.ts' })])
      text(a.value)
      console.log('lines', { n: 2 })
      return b.value.length
    `,
      [tracked],
    )
    expect(events).toEqual(['start', 'start', 'end', 'end'])
    expect(result).toEqual({
      ok: true,
      value: 'contents of b.ts'.length,
      output: [
        { type: 'text', text: 'contents of a.ts' },
        { type: 'text', text: 'lines {"n":2}' },
      ],
    })
  })

  test('has no capability beyond its tools, and hands a failing tool to the script as an Error', async () => {
    const boom: ScriptTool = {
      name: 'boom-tool',
      description: 'fails',
      inputSchema: { type: 'object' },
      execute: async () => {
        throw new Error('the tool refused')
      },
    }
    const result = await run(
      `
      const missing = [typeof fetch, typeof require, typeof process, typeof setTimeout, typeof WebAssembly]
      try { await tools.boom_tool({}) } catch (error) { text('caught: ' + error.message) }
      try { tools.reed } catch (error) { text(error.message) }
      return missing
    `,
      [boom, read],
    )
    expect(result).toEqual({
      ok: true,
      value: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'],
      output: [
        { type: 'text', text: 'caught: the tool refused' },
        { type: 'text', text: 'tools.reed does not exist. Available: boom_tool, read.' },
      ],
    })
  })

  test('a throw, a syntax error, a deadline, a stall and an abort are results, not rejections', async () => {
    expect(await run(`text('before'); throw new TypeError('nope')`)).toMatchObject({
      ok: false,
      error: { message: 'nope', stack: expect.stringContaining('TypeError: nope') },
      output: [{ type: 'text', text: 'before' }],
    })
    expect(await run(`return (`)).toMatchObject({
      ok: false,
      error: { message: expect.any(String) },
    })
    expect(await run(`while (true) {}`, [], 200)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('timed out') },
    })
    expect(await run(`while (true) await null`, [], 200)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('timed out') },
    })
    expect(await run(`await new Promise(() => {})`)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('never settle') },
    })

    const controller = new AbortController()
    let callSignal: AbortSignal | undefined
    let called!: () => void
    const inCall = new Promise<void>((resolve) => (called = resolve))
    const slow: ScriptTool = {
      ...read,
      execute: async (_input, signal) => {
        callSignal = signal
        called()
        await new Promise<void>(() => {}) // only the abort ends it
      },
    }
    const pending = run(
      `await tools.read({ path: 'x' }); return 1`,
      [slow],
      10_000,
      controller.signal,
    )
    // Stop once the call is under way, however long the worker took to start.
    await inCall
    controller.abort()
    expect(await pending).toMatchObject({
      ok: false,
      error: { message: 'The script was cancelled' },
    })
    expect(callSignal?.aborted).toBe(true)
  })

  test('exit() ends the script with its output, and runaway output fails it', async () => {
    expect(await run(`text('a'); exit(); text('b')`)).toEqual({
      ok: true,
      value: undefined,
      output: [{ type: 'text', text: 'a' }],
    })
    const flood = await run(`for (;;) text('')`)
    expect(flood).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('output passed') },
    })
  })

  test('deep recursion and a heap past its limit fail the script, not the host', async () => {
    expect(await run(`const f = (n) => f(n + 1) + 1; return f(0)`)).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/stack/i) },
    })
    const small = createScriptSandbox({ memoryLimitBytes: 8 * 1024 * 1024 })
    const result = await small.run({
      code: `const a = []; for (;;) a.push('x'.repeat(1024) + a.length)`,
      tools: [],
      timeoutMs: 10_000,
    })
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/memory/i) },
    })
  })

  test('takes images as base64 of a format providers accept, typed by their bytes', async () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    expect(await run(`image('data:image/jpeg;base64,${png}')`)).toEqual({
      ok: true,
      value: undefined,
      output: [{ type: 'image', data: png, mimeType: 'image/png' }],
    })
    expect(await run(`image('https://example.com/a.png')`)).toMatchObject({ ok: false })
  })
})
