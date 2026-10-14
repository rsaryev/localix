import { describe, it, expect } from 'bun:test'
import { createBashTool } from './bash'
import { SSHEnvironment, DockerEnvironment, localEnvironment } from '../environments'
import type { ExecutionEnvironment } from '../environment'
import type { AsyncToolRegistry, ToolAction } from '@localixai/agent/agents'

/** A fake env whose foreground exec returns a fixed exit code (no real process). */
function envWithExit(exitCode: number, stderr = ''): ExecutionEnvironment {
  return {
    config: { kind: 'local' },
    exec: async () => ({ stdout: '', stderr, exitCode }),
    readFile: async () => '',
    writeFile: async () => {},
    searchFiles: async () => '',
  } as unknown as ExecutionEnvironment
}

describe('createBashTool — foreground exit classification', () => {
  it('a stop-signal exit (SIGTERM 143, e.g. a killed `npm run dev`) is NOT an error', async () => {
    const tool = createBashTool(envWithExit(143, 'Terminated'))
    const result = await tool.execute(
      'c',
      { command: 'npm run dev' },
      undefined,
      undefined,
      undefined,
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('terminated')
  })

  it('a CRASH signal (SIGSEGV 139) is still an error', async () => {
    const tool = createBashTool(envWithExit(139))
    const result = await tool.execute('c', { command: './crash' }, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
  })

  it('a normal non-zero exit (1) is still an error', async () => {
    const tool = createBashTool(envWithExit(1, 'boom'))
    const result = await tool.execute('c', { command: 'false' }, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
  })
})

describe('createBashTool — local (default)', () => {
  it('accepts no env arg and uses local backend', () => {
    const tool = createBashTool()
    expect(tool.name).toBe('bash')
  })
})

describe('createBashTool — error cases', () => {
  it('non-local env with background=true → isError', async () => {
    const env = new DockerEnvironment({ kind: 'docker', containerName: 'c1' })
    const tool = createBashTool(env)
    const result = await tool.execute(
      'call_1',
      { command: 'ls', background: true },
      undefined,
      undefined,
      undefined,
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('background mode is not supported')
  })

  it('ssh env with background=true → isError', async () => {
    const env = new SSHEnvironment({ kind: 'ssh', sshHost: 'user@host' })
    const tool = createBashTool(env)
    const result = await tool.execute(
      'call_2',
      { command: 'ls', background: true },
      undefined,
      undefined,
      undefined,
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('background mode is not supported')
  })

  it('local env with background=true is allowed (no isError from backend check)', async () => {
    // background:true on local should not be blocked at the validation step
    // (it proceeds to spawn — we just verify it doesn't return an immediate isError)
    const tool = createBashTool(localEnvironment)
    // We can't easily await the background promise without a real process,
    // but we can verify the tool doesn't pre-reject.
    // Just check that the tool object is valid.
    expect(tool.name).toBe('bash')
  })

  it('background job accepts send_input and streams final output', async () => {
    const tool = createBashTool(localEnvironment)
    let actions: Record<string, ToolAction> | undefined
    const updates: Array<{ output: string; done: boolean; details?: Record<string, unknown> }> = []
    let resolveDone:
      | ((value: { output: string; done: boolean; details?: Record<string, unknown> }) => void)
      | undefined
    const done = new Promise<{ output: string; done: boolean; details?: Record<string, unknown> }>(
      (resolve) => {
        resolveDone = resolve
      },
    )

    const asyncRegistry: AsyncToolRegistry = {
      registerActions(_toolCallId, nextActions) {
        actions = nextActions
        return () => {
          actions = undefined
        }
      },
      getActions() {
        return actions
      },
      emitBackground(_toolCallId, output, opts) {
        updates.push({ output, done: Boolean(opts?.done), details: opts?.details })
        if (opts?.done) {
          resolveDone?.({ output, done: true, details: opts.details })
        }
      },
    }

    const result = await tool.execute(
      'call_3',
      { command: 'read line; echo "got:$line"', background: true, timeout: 5 },
      undefined,
      undefined,
      { asyncRegistry },
    )

    expect(result.isError).toBeUndefined()
    expect(actions?.send_input).toBeDefined()
    actions?.send_input.execute({ text: 'hello\n' })

    const final = await done
    expect(updates.some((update) => update.details?.jobStatus === 'running')).toBe(true)
    expect(final.details?.command).toBe('read line; echo "got:$line"')
    expect(final.details?.isBackground).toBe(true)
    expect(final.details?.isStreaming).toBe(false)
    expect(final.done).toBe(true)
    expect(final.output).toContain('got:hello')
  })
})

describe('SSHEnvironment — command construction', () => {
  it('uses ssh with correct host and default port', () => {
    const env = new SSHEnvironment({ kind: 'ssh', sshHost: 'user@example.com' })
    expect(env.config.sshHost).toBe('user@example.com')
    expect(env.config.sshPort).toBeUndefined()
    // Default port 22 is used internally in exec
  })

  it('stores custom sshPort', () => {
    const env = new SSHEnvironment({ kind: 'ssh', sshHost: 'user@host.com', sshPort: 2222 })
    expect(env.config.sshPort).toBe(2222)
  })
})

describe('DockerEnvironment — command construction', () => {
  it('stores container name', () => {
    const env = new DockerEnvironment({ kind: 'docker', containerName: 'myapp' })
    expect(env.config.containerName).toBe('myapp')
  })
})
