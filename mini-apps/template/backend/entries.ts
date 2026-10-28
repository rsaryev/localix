import { defineCollection } from '@localixai/mini-app-sdk/backend'
import { ENTRIES, entryInputSchema, entrySchema } from '../shared/model'

/**
 * The entries collection: where they are kept and how one is made. `createMiniApp` turns this into
 * the store under the app's data folder, the routes `/rpc/<app>/entries` (list, add, change,
 * remove — each answering with the new list), the feed that updates an open screen the moment the
 * agent writes, and the index that finds entries by meaning.
 */
export const entriesSpec = defineCollection({
  name: ENTRIES,
  item: entrySchema,
  input: entryInputSchema,
  // Kept in UTC, whatever offset the agent wrote it with, so every stored time reads the same way.
  create: (input, { id, now }) => ({ ...input, id, at: new Date(input.at ?? now).toISOString() }),
  // One list for the whole app. `scope: 'chat'` keeps one per chat instead (a game, a board).
  scope: 'app',
  limit: 5000,
  // What the embedding model reads to find an entry by meaning (`template_find_entries`).
  search: (entry) => [entry.title, entry.category, entry.note].filter(Boolean).join(' — '),
})
