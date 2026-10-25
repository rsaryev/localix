import { createServer, type Server } from 'node:http'

/**
 * The loopback listener for a server that fixes `oauth.callbackPort` (Claude Code: the redirect is
 * `http://localhost:PORT/callback`, which the authorization server may have been told exactly).
 * The API's own callback route cannot receive that, so a sign-in on a fixed port listens there
 * until it ends: it answers `/callback` once, hands the `code` and `state` to `finish`, and is
 * closed with the flow (finished, expired or replaced).
 *
 * It binds the IPv4 and IPv6 loopback addresses, never the network: `localhost` may resolve to
 * either. A port that is taken fails the sign-in at once, naming the port.
 */
export interface CallbackListener {
  close(): Promise<void>
}

export interface CallbackOutcome {
  ok: boolean
  serverName?: string
  error?: string
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function page(outcome: CallbackOutcome): string {
  const title = outcome.ok ? 'Signed in' : 'Sign-in failed'
  const detail = outcome.ok
    ? `Connected${outcome.serverName ? ` to <b>${escapeHtml(outcome.serverName)}</b>` : ''}. You can close this tab.`
    : escapeHtml(outcome.error ?? 'Something went wrong.')
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;margin:3rem"><h2>${title}</h2><p>${detail}</p></body>`
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host }, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

export async function listenForCallback(
  port: number,
  finish: (state: string, code: string) => Promise<CallbackOutcome>,
): Promise<CallbackListener> {
  const handler: Parameters<typeof createServer>[1] = (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const reply = (status: number, outcome: CallbackOutcome) => {
      response.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        connection: 'close',
      })
      response.end(page(outcome))
    }
    if (url.pathname !== '/callback') return reply(404, { ok: false, error: 'Not found.' })
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (error) return reply(400, { ok: false, error })
    if (!code || !state) return reply(400, { ok: false, error: 'Missing code or state' })
    void finish(state, code).then(
      (outcome) => reply(outcome.ok ? 200 : 400, outcome),
      (e: unknown) => reply(400, { ok: false, error: e instanceof Error ? e.message : String(e) }),
    )
  }
  const servers: Server[] = []
  // The listening sockets close at once; a reply still being written finishes on its connection
  // (waiting for it here would wait on the very callback that is closing the flow).
  const closeAll = async () => {
    for (const s of servers) {
      s.close()
      s.closeIdleConnections()
    }
  }
  const ipv4 = createServer(handler)
  servers.push(ipv4)
  try {
    await listen(ipv4, port, '127.0.0.1')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new Error(
      code === 'EADDRINUSE'
        ? `callbackPort ${port} is already in use`
        : `callbackPort ${port} could not be opened: ${(error as Error).message}`,
    )
  }
  const ipv6 = createServer(handler)
  try {
    await listen(ipv6, port, '::1')
    servers.push(ipv6)
  } catch {
    // No IPv6 loopback here: `localhost` then resolves to IPv4.
  }
  return { close: closeAll }
}
