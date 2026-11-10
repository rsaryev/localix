import type { MonitorProc, MonitorSpawner } from '../monitor-stream'

/**
 * A monitor spawner for tests: each process prints `lines`, then ends unless `keepOpen` (it then
 * ends when killed). Records what was spawned, where, and with which environment.
 */
export function fakeMonitorSpawner(options: { lines?: string[]; keepOpen?: boolean } = {}) {
  const calls: { command: string; cwd: string }[] = []
  const envs: Record<string, string | undefined>[] = []
  let killed = 0
  const spawn: MonitorSpawner = (command, { cwd, env }): MonitorProc => {
    calls.push({ command, cwd })
    envs.push(env)
    const exited = Promise.withResolvers<number>()
    let output: ReadableStreamDefaultController<Uint8Array> | undefined
    let open = true
    const close = () => {
      if (open) output?.close()
      open = false
      exited.resolve(0)
    }
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller
        for (const line of options.lines ?? []) controller.enqueue(new TextEncoder().encode(line))
        if (!options.keepOpen) close()
      },
    })
    return {
      stdout,
      exited: exited.promise,
      kill: () => {
        killed += 1
        close()
      },
    }
  }
  return { spawn, calls, envs, killed: () => killed }
}
