import { z } from 'zod'

/** Shared store invalidation protocol. Frames identify a scope and never contain stored data. */
export const STORE_FRAME_TAG = 'c'
export const storeFeedCommands = (plugin: string) => ({
  subscribe: `${plugin}:store.subscribe`,
  unsubscribe: `${plugin}:store.unsubscribe`,
})
export const storeFrameSchema = z.object({
  plugin: z.string(),
  sessionId: z.string().nullable(),
  /** True only when both committed writes and external disk edits are covered. */
  live: z.boolean().optional(),
})
export type StoreFrame = z.infer<typeof storeFrameSchema>
