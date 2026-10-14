import { client, unwrap } from './internal'
import type { PruneResult, StorageUsage } from '@localixai/api/client'

/** Disk use of the app's data and removal of old conversations (`/rpc/storage`). */
export const storageApi = {
  async usage(): Promise<StorageUsage> {
    return unwrap(await client.rpc.storage.usage.$get())
  },
  /** `dryRun: true` only counts; deleting needs an explicit `false`. */
  async prune(input: { olderThanDays: number; dryRun: boolean }): Promise<PruneResult> {
    return unwrap(await client.rpc.storage.prune.$post({ json: input }))
  },
}

export type { PruneResult, StorageUsage }
