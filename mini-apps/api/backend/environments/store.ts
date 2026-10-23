/**
 * Persisted environment contract — named sets of `{{ variable }}` values.
 *
 * Plain variables are stored as written. Secret variables store a native-vault reference only;
 * their literal values never enter this record.
 */

import type { EnvironmentVariable } from '../collection/environments'

export interface SavedEnvironment {
  /** The environment's name, and its identity — `save` with an existing name overwrites it. */
  id: string
  createdAt: number
  updatedAt: number
  /** Exactly one environment is active per user; `use` is what moves the flag. */
  active: boolean
  variables: EnvironmentVariable[]
}
