import { expect, test } from 'bun:test'

// A UI test that forgets to stub the client must never reach a server, the person's running
// Localix on loopback least of all: the shared loopback-friendly guard may not wrap this one.
test('an unmocked loopback request fails in the UI suite and never reaches the server', async () => {
  let reached = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => {
      reached++
      return new Response('live')
    },
  })
  try {
    await expect(fetch(`http://127.0.0.1:${server.port}/rpc/sessions/x`)).rejects.toThrow(
      '[test network guard]',
    )
    expect(reached).toBe(0)
  } finally {
    await server.stop(true)
  }
})
