import { z } from 'zod'

/** Shared store invalidation protocol. Frames identify a scope and never contain stored data. */
export const STORE_FRAME_TAG = 'c'
export const storeFeedCommands = (miniApp: string) => ({
  subscribe: `${miniApp}:store.subscribe`,
  unsubscribe: `${miniApp}:store.unsubscribe`,
})
export const storeFrameSchema = z.object({
  miniApp: z.string(),
  sessionId: z.string().nullable(),
  /** True only when both committed writes and external disk edits are covered. */
  live: z.boolean().optional(),
})
export type StoreFrame = z.infer<typeof storeFrameSchema>
