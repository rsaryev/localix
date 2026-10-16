import { describe, expect, test } from 'bun:test'
import { runHookCommand, type HookCommandOptions } from './command'

const options = (command: string, extra: Partial<HookCommandOptions> = {}): HookCommandOptions => ({
  command,
  cwd: process.cwd(),
  input: '',
  env: {},
  timeoutMs: 2_000,
  maxOutputBytes: 1024,
  ...extra,
})

describe('native hook command transport', () => {
  test('transports supplied input and exit code without interpreting a hook protocol', async () => {
    const result = await runHookCommand(
      options('cat; printf warning >&2; exit 2', { input: 'opaque input' }),
    )
    expect(result).toEqual({
      code: 2,
      stdout: 'opaque input',
      stderr: 'warning',
      timedOut: false,
      aborted: false,
    })
  })

  test('environment conventions belong to the caller', async () => {
    const result = await runHookCommand(
      options('printf "%s:%s" "$HOOK_TEST_VALUE" "$CLAUDE_PROJECT_DIR"', {
        env: { HOOK_TEST_VALUE: 'provided' },
      }),
    )
    expect(result.stdout).toBe('provided:')
  })

  test('caps each output stream in bytes without corrupting a partial UTF-8 character', async () => {
    const result = await runHookCommand(
      options("printf 'éééé'; printf abcdefgh >&2", { maxOutputBytes: 5 }),
    )
    expect(result.stdout).toBe('éé')
    expect(result.stderr).toBe('abcde')
    expect(new TextEncoder().encode(result.stdout).length).toBeLessThanOrEqual(5)
  })

  test('a cancelled command settles separately from a timeout', async () => {
    const controller = new AbortController()
    const pending = runHookCommand(options('exec sleep 10', { signal: controller.signal }))
    controller.abort()
    const result = await pending
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.code).not.toBe(0)
  })

  test('a pre-cancelled invocation never spawns even with an invalid working directory', async () => {
    const result = await runHookCommand(
      options('exit 0', {
        signal: AbortSignal.abort(),
        cwd: '/nonexistent-hook-test-directory',
      }),
    )
    expect(result).toEqual({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true })
  })

  test('a timed out process is marked as timed out', async () => {
    const result = await runHookCommand(options('exec sleep 10', { timeoutMs: 30 }))
    expect(result.timedOut).toBe(true)
    expect(result.aborted).toBe(false)
  })

  test('invalid limits cannot create an unbounded execution', () => {
    expect(() => runHookCommand(options('exit 0', { timeoutMs: Infinity }))).toThrow('limits')
    expect(() => runHookCommand(options('exit 0', { maxOutputBytes: -1 }))).toThrow('limits')
  })
})
