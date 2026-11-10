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

  test('exec form passes each argument verbatim, with no shell to expand it', async () => {
    const result = await runHookCommand(
      options(process.execPath, {
        args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(-2)))', '$HOME', '*'],
      }),
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['$HOME', '*'])
  })

  test('exec form reports a missing executable as stderr without throwing', async () => {
    const result = await runHookCommand(
      options('/nonexistent-hook-binary', { args: [], env: { PATH: '' } }),
    )
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('nonexistent-hook-binary')
    expect(result.startError).toContain('nonexistent-hook-binary')
  })

  test('an argument the system refuses is a start error, not a throw', async () => {
    const result = await runHookCommand(options(process.execPath, { args: ['a\u0000b'] }))
    expect(result).toMatchObject({ code: null, timedOut: false, aborted: false })
    expect(result.startError).toContain('null bytes')
    expect(result.stderr).toBe(result.startError ?? '')
  })

  test('a process that ran has no start error, whatever its exit', async () => {
    const result = await runHookCommand(options('printf oops >&2; exit 3'))
    expect(result.startError).toBeUndefined()
  })

  test('merged output carries stderr in stdout, under the one stdout cap', async () => {
    const result = await runHookCommand(
      options('printf ab; printf cd >&2', { mergeStderr: true, maxOutputBytes: 3 }),
    )
    expect(result.stdout).toHaveLength(3)
    expect(result.stderr).toBe('')
  })

  test('invalid limits cannot create an unbounded execution', () => {
    expect(() => runHookCommand(options('exit 0', { timeoutMs: Infinity }))).toThrow('limits')
    expect(() => runHookCommand(options('exit 0', { maxOutputBytes: -1 }))).toThrow('limits')
  })
})
