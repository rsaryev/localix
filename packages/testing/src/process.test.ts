import { describe, expect, test } from 'bun:test'

import { run, runSync } from './process'

describe('deadline-bound processes', () => {
  test('captures output and exit code without throwing on failure', async () => {
    const result = await run('sh', ['-c', 'echo out; echo err >&2; exit 3'])
    expect(result).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false })
    expect(runSync('sh', ['-c', 'cat'], { input: 'piped' }).stdout).toBe('piped')
  })

  test('kills a child that misses its deadline', async () => {
    const started = Date.now()
    const result = await run('sleep', ['30'], { timeoutMs: 100 })
    expect(result.timedOut).toBe(true)
    expect(result.code).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(runSync('sleep', ['30'], { timeoutMs: 100 }).timedOut).toBe(true)
  })
})
