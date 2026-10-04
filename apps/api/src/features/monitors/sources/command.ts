/**
 * `watch` mode: a long-lived command whose stdout LINES are the events.
 *
 * This is the shape for anything that already pushes (`tail -f | grep --line-buffered`,
 * `inotifywait -m`, a poll loop the agent wrote itself, a language runtime printing progress).
 * The source contributes exactly three things the caller would otherwise get wrong:
 *
 *   - chunk→line assembly through the shared splitter, so a line split across two reads is
 *     one event and a trailing line without a newline is not lost at exit;
 *   - the exit is an OUTCOME, not silence: the last partial line is flushed and the exit code
 *     travels in `detail`, because a watch that dies immediately (typo, missing binary) must
 *     read differently from one that is quietly waiting;
 *   - `close()` kills the process tree via the borrowed spawner, so a killed monitor does not
 *     leave a `tail` behind holding a file handle.
 */
import { createLineSplitter } from '../../../lib/line-splitter'
import type { BackgroundSpawn, MonitorSource, MonitorSourceExit } from './index'

export function createCommandSource(input: {
  command: string
  cwd: string
  pathPrefix?: string[]
  /** Resolved vault values, injected into the child's environment (see `../secrets.ts`). */
  env?: Record<string, string>
  spawn: BackgroundSpawn
}): MonitorSource {
  const splitter = createLineSplitter()
  let emit: (text: string) => void = () => {}
  let proc: ReturnType<BackgroundSpawn> | null = null
  let closed = false
  let settle: (exit: MonitorSourceExit) => void = () => {}
  const exited = new Promise<MonitorSourceExit>((resolve) => {
    settle = resolve
  })

  return {
    onEvent(listener) {
      emit = listener
    },
    start() {
      if (closed) return
      try {
        proc = input.spawn({
          command: input.command,
          cwd: input.cwd,
          ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}),
          ...(input.env ? { env: input.env } : {}),
        })
      } catch (error) {
        settle({
          reason: 'error',
          detail: `could not start: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }
      proc.onOutput((chunk) => {
        for (const line of splitter.push(chunk)) emit(line)
      })
      void proc.exited.then((code) => {
        for (const line of splitter.flush()) emit(line)
        if (closed) return
        settle({
          reason: 'exited',
          detail: code === 0 ? 'exit 0' : `exit ${code ?? '?'}`,
        })
      })
    },
    close() {
      if (closed) return
      closed = true
      proc?.kill()
    },
    exited,
  }
}
