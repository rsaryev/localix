import { z } from 'zod'

/**
 * The store feed's wire contract: the backend's NUDGE that a plugin's stored state changed, so an
 * open view re-reads at once instead of polling to find out.
 *
 * A view used to learn of a change only by looking. The agent changes state through its tool, and
 * a tool answers the agent, not the view — so a board polled every 800 ms while the agent owed a
 * move and every 4 s otherwise for as long as it stayed open, and still showed the move up to one
 * poll late. A frame names only WHICH scope changed — the plugin, and the chat (`null` for the
 * plugin's own folder) — never the state: the route decides what a reader may see (a Battleship
 * board hides the agent's ships), so the view re-reads through the route.
 *
 * Every plugin built from this frame shares the one tag, and `plugin` tells their frames apart;
 * the commands carry the plugin's name, as the host requires of a plugin's commands.
 */
export const STORE_FRAME_TAG = 'c'

export const storeFeedCommands = (plugin: string) => ({
  subscribe: `${plugin}:store.subscribe`,
  unsubscribe: `${plugin}:store.unsubscribe`,
})

export const storeFrameSchema = z.object({
  plugin: z.string(),
  sessionId: z.string().nullable(),
})

export type StoreFrame = z.infer<typeof storeFrameSchema>
