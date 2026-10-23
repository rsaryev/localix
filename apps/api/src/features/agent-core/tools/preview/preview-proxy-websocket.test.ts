import { expect, test } from 'bun:test'
import { buildInjectedPreviewUrl, disposeProxyServers } from './preview-proxy'

test('relays the HMR protocol, route and text/binary frames through a real proxy', async () => {
  const requests: Array<{ path: string; protocol: string | null }> = []
  const received: Array<string | Uint8Array> = []
  const upstream = Bun.serve<Record<string, never>>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
      const url = new URL(request.url)
      requests.push({
        path: url.pathname + url.search,
        protocol: request.headers.get('sec-websocket-protocol'),
      })
      if (server.upgrade(request, { data: {}, headers: { 'Sec-WebSocket-Protocol': 'vite-hmr' } }))
        return
      return new Response('Upgrade required', { status: 400 })
    },
    websocket: {
      message(socket, message) {
        received.push(typeof message === 'string' ? message : new Uint8Array(message))
        socket.send(message)
      },
    },
  })
  let client: WebSocket | undefined
  try {
    const url = buildInjectedPreviewUrl(`http://127.0.0.1:${upstream.port}/hmr?token=fixture`)
    expect(url).toBeDefined()
    const echoed = await new Promise<Array<string | Uint8Array>>((resolve, reject) => {
      const messages: Array<string | Uint8Array> = []
      client = new WebSocket(url!.replace(/^http/, 'ws'), 'vite-hmr')
      client.binaryType = 'arraybuffer'
      client.addEventListener('open', () => {
        client!.send('hot update 😀')
        client!.send(new Uint8Array([0, 1, 127, 128, 255]))
      })
      client.addEventListener('message', (event) => {
        messages.push(typeof event.data === 'string' ? event.data : new Uint8Array(event.data))
        if (messages.length === 2) resolve(messages)
      })
      client.addEventListener('error', () => reject(new Error('Preview WebSocket failed')))
      client.addEventListener('close', () => {
        if (messages.length !== 2)
          reject(new Error('Preview WebSocket closed before echoing frames'))
      })
    })
    expect(client!.protocol).toBe('vite-hmr')
    expect(requests).toEqual([{ path: '/hmr?token=fixture', protocol: 'vite-hmr' }])
    const frames = ['hot update 😀', new Uint8Array([0, 1, 127, 128, 255])]
    expect(received).toEqual(frames)
    expect(echoed).toEqual(frames)
  } finally {
    client?.close()
    disposeProxyServers()
    await upstream.stop(true)
  }
}, 3000)

/** An upstream that records each handshake's Origin and echoes frames. */
function originRecordingUpstream() {
  const origins: Array<string | null> = []
  const server = Bun.serve<Record<string, never>>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, srv) {
      origins.push(request.headers.get('origin'))
      if (srv.upgrade(request, { data: {} })) return
      return new Response('Upgrade required', { status: 400 })
    },
    websocket: {
      message(socket, message) {
        socket.send(message)
      },
    },
  })
  return { server, origins }
}

test('refuses a cross-site handshake instead of relaying it without its Origin', async () => {
  const { server, origins } = originRecordingUpstream()
  try {
    const url = buildInjectedPreviewUrl(`http://127.0.0.1:${server.port}/`)!
    const res = await fetch(`${url}rpc/ws`, {
      headers: {
        origin: 'https://attacker.example',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })
    expect(res.status).toBe(403)
    expect(origins).toEqual([])
  } finally {
    disposeProxyServers()
    await server.stop(true)
  }
}, 3000)

test('dials the upstream with the proxy origin, never without one', async () => {
  const { server, origins } = originRecordingUpstream()
  let client: WebSocket | undefined
  try {
    const url = buildInjectedPreviewUrl(`http://127.0.0.1:${server.port}/`)!
    const proxyOrigin = new URL(url).origin
    await new Promise<void>((resolve, reject) => {
      client = new WebSocket(`${url.replace(/^http/, 'ws')}hmr`, {
        headers: { origin: proxyOrigin },
      } as unknown as string[])
      client.addEventListener('open', () => client!.send('ping'))
      client.addEventListener('message', () => resolve())
      client.addEventListener('error', () => reject(new Error('Preview WebSocket failed')))
    })
    expect(origins).toEqual([proxyOrigin])
  } finally {
    client?.close()
    disposeProxyServers()
    await server.stop(true)
  }
}, 3000)
