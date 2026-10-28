import { describe, expect, test } from 'bun:test'

import type { ScriptTool } from '@localixai/agent/runtime'

import { MAX_CALLS, MAX_CONCURRENT_CALLS, MAX_OUTPUT_CHARS } from './limits'
import { createScriptSandbox } from './sandbox'

/**
 * What a hostile script can cost the host: built-ins it patches cannot make the prelude misreport
 * its output, and its calls are queued and counted on the host.
 */
const sandbox = createScriptSandbox()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const run = (code: string, tools: ScriptTool[] = [], timeoutMs = 20_000) =>
  sandbox.run({ code, tools, timeoutMs })

const outputChars = (output: { type: string; text?: string; data?: string }[]) =>
  output.reduce((sum, item) => sum + (item.text ?? item.data ?? '').length, 0)

describe('a script that patches built-ins', () => {
  test('cannot make console output lie about its length', async () => {
    const result = await run(`
      const big = 'x'.repeat(1024 * 1024)
      try { Array.prototype.join = () => ({ length: 0, toString: () => big }) } catch {}
      try { Object.defineProperty(Array.prototype, 'map', { value: () => [big] }) } catch {}
      for (let i = 0; i < 20; i++) console.log('a', 'b')
      return [1, 2].join('-')
    `)
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ value: '1-2' })
    expect(result.output).toHaveLength(20)
    expect(result.output[0]).toEqual({ type: 'text', text: 'a b' })
    expect(outputChars(result.output)).toBeLessThan(MAX_OUTPUT_CHARS)
  })

  test('cannot pass off bytes that are not an image as one', async () => {
    const result = await run(`
      try { String.prototype.replace = function () { return this } } catch {}
      try { RegExp.prototype.test = () => true } catch {}
      try { Array.prototype.find = () => ['image/png'] } catch {}
      try { image('data:image/png;base64,<<notbase64>>!!!') } catch (error) { text(error.message) }
    `)
    expect(result.output.some((item) => item.type === 'image')).toBe(false)
  })

  test('still runs ordinary code that assigns over inherited built-in names', async () => {
    const result = await run(`
      class Oops extends Error { constructor() { super('x'); this.name = 'Oops' } }
      const plain = { toString() { return 'plain' } }
      plain.valueOf = () => 7
      return [new Oops().name, String(plain), plain + 1]
    `)
    expect(result).toMatchObject({ ok: true, value: ['Oops', 'plain', 8] })
  })
})

describe('a script that floods its tools', () => {
  test(`runs at most ${MAX_CONCURRENT_CALLS} calls at once and finishes them all`, async () => {
    let running = 0
    let peak = 0
    const read: ScriptTool = {
      name: 'read',
      description: 'Read a file',
      inputSchema: { type: 'object' },
      execute: async () => {
        peak = Math.max(peak, ++running)
        await sleep(0)
        running--
        return 'ok'
      },
    }
    const result = await run(
      `return (await Promise.all(Array.from({ length: 40 }, () => tools.read({})))).length`,
      [read],
    )
    expect(result).toMatchObject({ ok: true, value: 40 })
    expect(peak).toBe(MAX_CONCURRENT_CALLS)
  })

  test(`fails past ${MAX_CALLS} calls without running the rest`, async () => {
    let executed = 0
    const bash: ScriptTool = {
      name: 'bash',
      description: 'Run a command',
      inputSchema: { type: 'object' },
      execute: async () => {
        executed++
        await sleep(0)
        return ''
      },
    }
    const result = await run(
      `await Promise.all(Array.from({ length: 5000 }, () => tools.bash({ command: 'true' })))`,
      [bash],
    )
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining(`more than ${MAX_CALLS} tool calls`) },
    })
    expect(executed).toBeLessThanOrEqual(MAX_CALLS)
  })
})

describe('the deadline', () => {
  test('a deadline that is not a finite number is none', async () => {
    expect(await run(`return 1`, [], Number.POSITIVE_INFINITY)).toMatchObject({
      ok: true,
      value: 1,
    })
  })

  test('a sandbox whose QuickJS is missing fails the run, not its creation', async () => {
    const broken = createScriptSandbox({ wasmPath: 'missing/quickjs.wasm' })
    expect(await broken.run({ code: 'return 1', tools: [], timeoutMs: 5_000 })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('could not load QuickJS') },
    })
  })
})
