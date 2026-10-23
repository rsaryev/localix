/**
 * The environment operations contract. Production implements it over the collection's files in
 * `file-service.ts`.
 */

import type { EnvironmentVariable } from '../collection/environments'
import type { SavedEnvironment } from './store'

export interface EnvironmentService {
  list(userId: string): Promise<SavedEnvironment[]>
  get(userId: string, name: string): Promise<SavedEnvironment | null>
  save(userId: string, name: string, variables: EnvironmentVariable[]): Promise<SavedEnvironment>
  use(userId: string, name: string): Promise<SavedEnvironment | null>
  /** Clear the active flag everywhere — requests then use their literal urls. */
  deactivate(userId: string): Promise<void>
  remove(userId: string, name: string): Promise<boolean>
  rename(userId: string, from: string, to: string): Promise<SavedEnvironment | null>
  /** The active environment's variables as a lookup, or an empty map when none is active. */
  activeVars(
    userId: string,
    options?: { resolveSecrets?: boolean; requestName?: string },
  ): Promise<ReadonlyMap<string, string>>
  activeName(userId: string): Promise<string | null>
}
