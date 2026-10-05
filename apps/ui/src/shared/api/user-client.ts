/**
 * The user profile endpoints. One of the
 * `backendClient` domain modules spread into the facade in `./client`, so
 * `backendClient.getUserProfile()` keeps working unchanged.
 */

import { client, unwrap } from './internal'
import type { UserProfile, UpdateUserProfileRequest } from './contracts'

const PROFILE_BOOTSTRAP_TIMEOUT_MS = 5_000

export const userApi = {
  /** The agent's tool catalog + category labels (Settings → Tools). */

  async getUserProfile(): Promise<UserProfile> {
    // A loopback connection normally fails fast while the desktop sidecar is still
    // booting. Still bound the request: if a process accepts TCP but stalls before
    // answering, the settings bootstrap must be able to release its in-flight guard
    // and retry instead of waiting on one promise forever.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROFILE_BOOTSTRAP_TIMEOUT_MS)
    try {
      return unwrap(
        await client.rpc.user.profile.$get(undefined, { init: { signal: controller.signal } }),
      )
    } finally {
      clearTimeout(timeout)
    }
  },

  async updateUserProfile(patch: UpdateUserProfileRequest): Promise<UserProfile> {
    return unwrap(await client.rpc.user.profile.$patch({ json: patch }))
  },
}
