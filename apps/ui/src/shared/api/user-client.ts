/**
 * The user profile endpoints. One of the
 * `backendClient` domain modules spread into the facade in `./client`, so
 * `backendClient.getUserProfile()` keeps working unchanged.
 */

import type {
  ViewStateAddress,
  ViewStateKind,
  ViewStateSnapshot,
  ViewStateWrite,
  ViewStateWriteResult,
} from '@localixai/api/client'
import { client, unwrap } from './internal'
import type { UserProfile, UpdateUserProfileRequest } from './contracts'

const PROFILE_BOOTSTRAP_TIMEOUT_MS = 5_000

export const userApi = {
  async getViewState<K extends ViewStateKind>(
    address: ViewStateAddress & { kind: K },
    signal?: AbortSignal,
  ): Promise<ViewStateSnapshot<K>> {
    return (await unwrap(
      await client.rpc.user.state[':kind'][':key'].$get({ param: address }, { init: { signal } }),
    )) as ViewStateSnapshot<K>
  },
  async writeViewState(input: ViewStateWrite): Promise<ViewStateWriteResult> {
    return unwrap(await client.rpc.user.state.$put({ json: input }))
  },
  /** The agent's tool catalog + category labels (Settings → Tools). */

  async getUserProfile(signal?: AbortSignal): Promise<UserProfile> {
    // A loopback connection normally fails fast while the desktop sidecar is still
    // booting. Still bound the request: if a process accepts TCP but stalls before
    // answering, the settings bootstrap must be able to release its in-flight guard
    // and retry instead of waiting on one promise forever.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROFILE_BOOTSTRAP_TIMEOUT_MS)
    try {
      return unwrap(
        await client.rpc.user.profile.$get(undefined, {
          init: {
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
          },
        }),
      )
    } finally {
      clearTimeout(timeout)
    }
  },

  async updateUserProfile(patch: UpdateUserProfileRequest): Promise<UserProfile> {
    return unwrap(await client.rpc.user.profile.$patch({ json: patch }))
  },
}
