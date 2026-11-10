import { describe, expect, test } from 'bun:test'
import type { CommandRun } from '@rsaryev/llx-plugin'
import { hostCommandRunner } from './command-runner'

const run = (spec: CommandRun['spec'], extra: Partial<CommandRun> = {}): CommandRun => ({
  spec,
  cwd: process.cwd(),
  env: { PATH: process.env.PATH ?? '' },
  signal: new AbortController().signal,
  ...extra,
})
const runner = hostCommandRunner({ maxOutputBytes: 1024 })

describe('the command runner the kit asks for a process run', () => {
  test('runs a shell line with its input and gives its exit code and both streams', async () => {
    const result = await runner.run(
      run(
        { form: 'shell', command: 'cat; printf warn >&2; exit 2', shell: 'bash' },
        { stdin: 'in' },
      ),
    )
    expect(result).toEqual({ exitCode: 2, stdout: 'in', stderr: 'warn', timedOut: false })
  })

  test('runs a program with its arguments as they are, with no shell', async () => {
    const result = await runner.run(
      run({
        form: 'exec',
        command: process.execPath,
        args: ['-e', 'console.log(process.argv.at(-1))', '$HOME'],
      }),
    )
    expect(result.stdout.trim()).toBe('$HOME')
  })

  test('gives the process exactly the environment the kit built', async () => {
    const result = await runner.run(
      run(
        { form: 'shell', command: 'printf "%s" "$ONLY"', shell: 'bash' },
        { env: { ONLY: 'this', PATH: process.env.PATH ?? '' } },
      ),
    )
    expect(result.stdout).toBe('this')
  })

  test('says why a program never started', async () => {
    const result = await runner.run(run({ form: 'exec', command: '/no/such/program', args: [] }))
    expect(result.exitCode).toBeNull()
    expect(result.startError).toContain('/no/such/program')
  })

  test('reports a run past its time as timed out, and runs without a time limit when none is set', async () => {
    const late = await runner.run(
      run({ form: 'shell', command: 'exec sleep 10', shell: 'bash' }, { timeoutMs: 30 }),
    )
    expect(late).toMatchObject({ exitCode: null, timedOut: true })
    const open = await runner.run(run({ form: 'shell', command: 'exit 0', shell: 'bash' }))
    expect(open).toMatchObject({ exitCode: 0, timedOut: false })
  })

  test('merges stderr into stdout when asked', async () => {
    const result = await runner.run(
      run({ form: 'shell', command: 'printf a >&2', shell: 'bash' }, { mergeStderr: true }),
    )
    expect(result).toMatchObject({ stdout: 'a', stderr: '' })
  })

  test('an aborted run is killed', async () => {
    const controller = new AbortController()
    const pending = runner.run(
      run(
        { form: 'shell', command: 'exec sleep 10', shell: 'bash' },
        { signal: controller.signal },
      ),
    )
    controller.abort()
    expect(await pending).toMatchObject({ exitCode: null, timedOut: false })
  })
})
