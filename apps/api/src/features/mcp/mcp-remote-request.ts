import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

import { helperRequestHeaders } from './headers-helper'
import type { McpServerRecord } from './repository'

/**
 * HOW A REMOTE SERVER IS REACHED: the headers it is sent and the fetch that sends them.
 *
 * The headers are the config's static `headers` with its `headersHelper`'s output over them
 * (`headers-helper.ts`), read once per connection. The helper's headers live in one object the SDK
 * transport reads on every request, so when the server answers 401 or 403 the helper is run again,
 * the object is updated and that request retried once; later requests then carry the fresh
 * headers too. A helper that fails the second time leaves the server's answer as it was.
 *
 * `authorizedByHelper` says the helper supplied an `Authorization`: Claude Code takes that as the
 * server's authentication and does not fall back to OAuth, so the caller attaches no auth provider.
 */
export interface RemoteRequest {
  requestInit?: RequestInit
  fetch: FetchLike
  authorizedByHelper: boolean
}

export async function remoteRequest(
  server: McpServerRecord,
  config: Record<string, unknown>,
  cwd: string,
  baseFetch: FetchLike = fetch,
): Promise<RemoteRequest> {
  const { headers, helped, refresh } = await helperRequestHeaders(server, config, cwd)
  const origin = typeof config.url === 'string' ? new URL(config.url).origin : undefined
  const live: Record<string, string> = { ...headers }
  const retrying: FetchLike = async (input, init) => {
    const response = await baseFetch(input, init)
    if (!refresh || (response.status !== 401 && response.status !== 403)) return response
    const target = new URL(input)
    // A body that cannot be sent twice, or a request to another host, is not retried.
    if (target.origin !== origin || (init?.body != null && typeof init.body !== 'string'))
      return response
    let fresh: Record<string, string>
    try {
      fresh = await refresh()
    } catch {
      return response
    }
    for (const key of Object.keys(live)) delete live[key]
    Object.assign(live, fresh)
    const retryHeaders = new Headers(init?.headers)
    for (const [name, value] of Object.entries(fresh)) retryHeaders.set(name, value)
    return baseFetch(input, { ...init, headers: retryHeaders })
  }
  const lowered = Object.keys(headers).map((name) => name.toLowerCase())
  return {
    requestInit: Object.keys(headers).length > 0 ? { headers: live } : undefined,
    fetch: retrying,
    authorizedByHelper: helped && lowered.includes('authorization'),
  }
}
