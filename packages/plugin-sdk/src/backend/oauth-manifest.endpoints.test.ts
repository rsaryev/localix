import { describe, expect, test } from 'bun:test'

import { createManifestOAuthAdapter } from './oauth-manifest'
import type { ManifestOAuthSpec } from './oauth-manifest'

/**
 * A manifest's endpoint URLs are UNTRUSTED input — a plugin author writes them, and
 * the marketplace model means that author is not necessarily the user. Two of them
 * leave the process: `token.url` receives the authorization code, and
 * `authorize.url` is handed to the user's browser. Neither was checked.
 */

const spec = (over: Partial<ManifestOAuthSpec> = {}): ManifestOAuthSpec => ({
  loginLabel: 'Connect',
  authorize: { url: 'https://example.com/authorize', clientId: 'abc' },
  token: { url: 'https://example.com/token' },
  ...over,
})

const build = (over: Partial<ManifestOAuthSpec>) => () =>
  createManifestOAuthAdapter('plugin:probe', spec(over))

describe('manifest OAuth endpoints', () => {
  test('an https spec builds, as before', () => {
    expect(build({})).not.toThrow()
  })

  test('a cleartext token endpoint is refused', () => {
    // The authorization code is POSTed here. Over http it is readable by anyone on
    // the path, and the code is all an attacker needs to complete the exchange.
    expect(build({ token: { url: 'http://example.com/token' } })).toThrow(/https/i)
  })

  test('a cleartext authorize endpoint is refused', () => {
    expect(build({ authorize: { url: 'http://example.com/authorize' } })).toThrow(/https/i)
  })

  test('a cleartext refresh endpoint is refused', () => {
    expect(build({ refresh: { url: 'http://example.com/refresh' } })).toThrow(/https/i)
  })

  test('http on loopback is allowed — local providers are a real case', () => {
    // The existing localServer support exists precisely because loopback callbacks
    // are normal here, so refusing loopback http would break legitimate specs.
    expect(build({ token: { url: 'http://127.0.0.1:9000/token' } })).not.toThrow()
    expect(build({ authorize: { url: 'http://localhost:9000/authorize' } })).not.toThrow()
    expect(build({ token: { url: 'http://[::1]:9000/token' } })).not.toThrow()
  })

  test('a non-network scheme is refused', () => {
    // `authorize.url` is opened by the user's browser. `javascript:` there is script
    // execution, and `file:` is a local read — neither is an OAuth endpoint.
    expect(build({ authorize: { url: 'javascript:alert(1)' } })).toThrow()
    expect(build({ token: { url: 'file:///etc/passwd' } })).toThrow()
  })

  test('an unparseable URL is refused rather than carried into a request', () => {
    expect(build({ token: { url: 'not a url' } })).toThrow()
  })

  test('the refusal names the plugin and the offending field', () => {
    // A plugin author has to be able to tell WHICH of three URLs is wrong.
    expect(build({ refresh: { url: 'http://example.com/refresh' } })).toThrow(/refresh/)
    expect(build({ refresh: { url: 'http://example.com/refresh' } })).toThrow(/plugin:probe/)
  })
})
