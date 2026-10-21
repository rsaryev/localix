import { describe, expect, test } from 'bun:test'

import { allowNetwork } from './network-guard'

describe('network guard', () => {
  test('a request to a remote host fails at once, naming the URL', async () => {
    expect(fetch('https://example.com/api')).rejects.toThrow(
      'Unmocked network request in a test: https://example.com/api',
    )
  })

  test('loopback stays open for local servers', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('local') })
    try {
      expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe('local')
    } finally {
      server.stop(true)
    }
  })

  test('allowNetwork lifts the guard only for its callback', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('ok') })
    try {
      // A non-loopback name for the same server proves the guard was lifted, without the internet.
      const url = `http://localhost.:${server.port}/`
      expect(fetch(url)).rejects.toThrow('Unmocked network request')
      expect(await allowNetwork(async () => (await fetch(url)).text())).toBe('ok')
    } finally {
      server.stop(true)
    }
  })
})
