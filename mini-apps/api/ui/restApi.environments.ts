/**
 * The environments half of the `/rpc/api` client.
 *
 * Split from the requests half when the file crossed the repo's size ratchet, and the seam is the
 * right one: an environment is the SET OF VARIABLES a request interpolates, so the two collections
 * are edited by different surfaces and read by different ones. This half is also the only one with
 * a cross-surface consequence — which deployment the next send hits is shown in the titlebar, the
 * sidebar picker and the request tab at once — which is why every verb here announces.
 */

import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'
import type {
  EnvironmentCreate,
  EnvironmentEdit,
  EnvironmentInfo,
  EnvironmentsResponse,
} from '../backend/contracts'
import { enc, readOr, u } from './restApi.transport'
import { API_ENVIRONMENTS } from './model/topics'

/**
 * Announce that the environments moved, and hand the value straight back.
 *
 * Wrapping the RESULT rather than adding a statement after it keeps every verb below a single
 * expression. The rule it carries is the one thing they all share: a write here is invisible to
 * the titlebar glyph and to any panel that is not the one you typed in, unless it is announced —
 * see `model/topics`.
 */
function environmentsMoved<T>(value: T): T {
  API_ENVIRONMENTS.invalidate()
  return value
}

export const environmentApi = {
  async environments(sessionId: string, signal?: AbortSignal): Promise<EnvironmentInfo[]> {
    return (
      await readOr<EnvironmentsResponse>(
        await miniAppApiFetch(u(sessionId)`/environments`, { signal }),
      )
    ).environments
  },

  /** Activate an environment; the empty name means "no environment" and deactivates all. */
  async useEnvironment(sessionId: string, name: string): Promise<void> {
    // Inlined rather than held in a local: `restApi.scope.test.ts` reads this file and requires
    // every `fetch` to name the `u` builder outright, so a route can never quietly lose its
    // sessionId behind a variable. Simple rule, unfoolable detector.
    await readOr<{ ok: true }>(
      name === ''
        ? await miniAppApiFetch(u(sessionId)`/environments/deactivate`, { method: 'POST' })
        : await miniAppApiFetch(u(sessionId)`/environments/${enc(name)}/use`, { method: 'POST' }),
    )
    API_ENVIRONMENTS.invalidate()
  },

  /** Create an environment. Blank name → `bad_request`, collision → `name_taken` (409). */
  async createEnvironment(sessionId: string, input: EnvironmentCreate): Promise<EnvironmentInfo> {
    return environmentsMoved(
      (
        await readOr<{ environment: EnvironmentInfo }>(
          await miniAppApiFetch(u(sessionId)`/environments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          }),
        )
      ).environment,
    )
  },

  /** Replace an environment's whole variable list (PUT-replaces, like a request edit). */
  async updateEnvironment(
    sessionId: string,
    name: string,
    edit: EnvironmentEdit,
  ): Promise<EnvironmentInfo> {
    return environmentsMoved(
      (
        await readOr<{ environment: EnvironmentInfo }>(
          await miniAppApiFetch(u(sessionId)`/environments/${enc(name)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(edit),
          }),
        )
      ).environment,
    )
  },

  async removeEnvironment(sessionId: string, name: string): Promise<void> {
    environmentsMoved(
      await readOr<{ ok: true }>(
        await miniAppApiFetch(u(sessionId)`/environments/${enc(name)}`, { method: 'DELETE' }),
      ),
    )
  },

  async renameEnvironment(sessionId: string, name: string, to: string): Promise<EnvironmentInfo> {
    return environmentsMoved(
      (
        await readOr<{ environment: EnvironmentInfo }>(
          await miniAppApiFetch(u(sessionId)`/environments/${enc(name)}/rename`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to }),
          }),
        )
      ).environment,
    )
  },

  async duplicateEnvironment(sessionId: string, name: string): Promise<EnvironmentInfo> {
    return environmentsMoved(
      (
        await readOr<{ environment: EnvironmentInfo }>(
          await miniAppApiFetch(u(sessionId)`/environments/${enc(name)}/duplicate`, {
            method: 'POST',
          }),
        )
      ).environment,
    )
  },
}
