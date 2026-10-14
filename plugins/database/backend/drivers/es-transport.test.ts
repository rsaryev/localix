/**
 * The Elasticsearch connect probe against a local HTTP stand-in. What the client library does
 * with a 404 ping is transport behaviour, so it is tested over real HTTP.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createEsDriver } from './es'

const servers: Array<{ stop(force?: boolean): unknown }> = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(status: number, headers?: Record<string, string>) {
  const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status, headers }) })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

describe('elasticsearch probe', () => {
  it('fails when the endpoint answers the ping with 404 (any web server does)', async () => {
    const driver = createEsDriver({ url: serve(404) })
    expect(driver.probe!()).rejects.toThrow('404')
    await driver.close()
  })

  it('passes for a 200 ping', async () => {
    const driver = createEsDriver({ url: serve(200, { 'x-elastic-product': 'Elasticsearch' }) })
    await driver.probe!()
    await driver.close()
  })
})
