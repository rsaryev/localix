export type ShutdownSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP'

export interface ServerSignalHandlersOptions {
  exit?: (code: number) => void
  reportError?: (error: unknown) => void
}

/**
 * Install the termination signals owned by a standalone API process.
 *
 * SIGHUP matters for SSH/tmux/terminal loss: without an explicit handler Node/Bun
 * terminates immediately and skips the same PTY/child/database cleanup used for
 * SIGINT and SIGTERM. The returned disposer also makes embedded/restarted servers
 * release their process listeners after a programmatic stop.
 */
export function installServerSignalHandlers(
  stop: () => Promise<void>,
  options: ServerSignalHandlersOptions = {},
): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const reportError =
    options.reportError ?? ((error: unknown) => console.error('API shutdown failed', error))
  let shutdownStarted = false

  const shutdownAndExit = async (): Promise<void> => {
    if (shutdownStarted) return
    shutdownStarted = true
    try {
      await stop()
      exit(0)
    } catch (error) {
      reportError(error)
      exit(1)
    }
  }
  const handler = (): void => void shutdownAndExit()
  const signals: readonly ShutdownSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) process.on(signal, handler)

  return () => {
    for (const signal of signals) process.off(signal, handler)
  }
}
