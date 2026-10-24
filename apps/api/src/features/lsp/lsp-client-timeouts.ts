import type { MessageConnection } from 'vscode-jsonrpc/node'

/**
 * The time limits a plugin's LSP server declares (`requestTimeout`, `shutdownTimeout`), applied to
 * one client's connection.
 */

/** Make every later request on `connection` fail after `ms` when the server never answers it. */
export function limitRequests(connection: MessageConnection, ms: number): void {
  const send = connection.sendRequest.bind(connection) as (...args: unknown[]) => Promise<unknown>
  ;(connection as { sendRequest: unknown }).sendRequest = (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const method = typeof args[0] === 'string' ? args[0] : 'request'
      const timer = setTimeout(
        () => reject(new Error(`LSP ${method} got no answer in ${ms} ms`)),
        ms,
      )
      send(...args).then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
}

/**
 * A graceful stop: `shutdown`, waited for up to `ms`, then `exit`; whatever is still running
 * afterwards is ended by `kill`.
 */
export async function shutDownWithin(
  connection: MessageConnection,
  ms: number,
  kill: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([connection.sendRequest('shutdown').catch(() => undefined), elapsed])
    await Promise.resolve(connection.sendNotification('exit')).catch(() => undefined)
  } catch {
    /* the connection is already gone */
  } finally {
    clearTimeout(timer)
    try {
      connection.dispose()
    } catch {
      /* idempotent */
    }
    kill()
  }
}
