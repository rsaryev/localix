import type { Collection, MiniAppContext } from '@localixai/mini-app-sdk/backend'
import {
  describeForAgent,
  entryInputSchema,
  summarize,
  type Entry,
  type Settings,
} from '../shared/model'
import type { entriesSpec } from './entries'

type Entries = Collection<Entry, (typeof entriesSpec)['input']['shape']>

/**
 * The agent's tools. The agent does the understanding — it reads the photo, the message, the
 * receipt — and calls these with structured input; the tools validate, store and answer with what
 * changed and where things stand, so the agent can tell the person in one sentence.
 *
 * Rules every tool here keeps:
 * - `mutates` and `classify` say what it changes: `host` for the app's own data.
 * - `executionMode: 'sequential'` for a tool that writes; reads may run in parallel.
 * - `isError: true` only for a call that did nothing because the input was wrong.
 */
export function createTools(ctx: MiniAppContext, entries: Entries, settings: Settings) {
  const { z } = ctx
  const summary = async () =>
    describeForAgent(summarize(await entries.list(), new Date(), settings))
  const { unit } = settings
  return [
    ctx.defineTool({
      name: 'template_log_entry',
      label: 'Log an entry',
      activeVerb: 'Logging',
      description: `Log one entry in Daily Log: a title, an amount in ${unit}, a category and an optional note and time. Answers with today's totals.`,
      // The shared schema with descriptions added: the agent is shown the limits the log keeps.
      inputSchema: entryInputSchema.extend({
        title: entryInputSchema.shape.title.describe('What it was, in a few words.'),
        amount: entryInputSchema.shape.amount.describe(`How much, in ${unit}.`),
      }),
      executionMode: 'sequential',
      mutates: true,
      classify: () => ({ effect: 'host' }),
      permissionPaths: () => [],
      async execute(_toolCallId, input) {
        const entry = await entries.add(input)
        return { content: `Logged ${entry.title}: ${entry.amount} ${unit}.\n${await summary()}` }
      },
    }),
    ctx.defineTool({
      name: 'template_summary',
      label: 'Daily Log summary',
      activeVerb: 'Reading Daily Log',
      description:
        "Read Daily Log: today's total against the goal, today's entries with their ids, and the last seven days.",
      inputSchema: z.object({}),
      executionMode: 'parallel',
      mutates: false,
      permissionPaths: () => [],
      async execute() {
        return { content: await summary() }
      },
    }),
    ctx.defineTool({
      name: 'template_find_entries',
      label: 'Find entries',
      activeVerb: 'Searching Daily Log',
      description:
        'Find past entries by meaning ("something sweet last week"). Empty while the embedding model is not ready: then read the summary instead.',
      inputSchema: z.object({ query: z.string().min(1).describe('What to look for.') }),
      executionMode: 'parallel',
      mutates: false,
      permissionPaths: () => [],
      async execute(_toolCallId, { query }) {
        const found = await entries.search(query, { limit: 10 })
        if (!found.length)
          return { content: 'No entries match by meaning (or search is not ready).' }
        return {
          content: found
            .map(
              (entry) => `- ${entry.at}: ${entry.title}, ${entry.amount} ${unit} (id ${entry.id})`,
            )
            .join('\n'),
        }
      },
    }),
    ctx.defineTool({
      name: 'template_remove_entry',
      label: 'Remove an entry',
      activeVerb: 'Removing',
      description:
        'Remove one entry by its id (the summary lists ids). Answers with today’s totals.',
      inputSchema: z.object({ id: z.string().min(1) }),
      executionMode: 'sequential',
      mutates: true,
      classify: () => ({ effect: 'host' }),
      permissionPaths: () => [],
      async execute(_toolCallId, { id }) {
        if (!(await entries.remove(id))) {
          return {
            content: `No entry has that id. Read template_summary for today's ids.`,
            isError: true,
          }
        }
        return { content: `Removed it.\n${await summary()}` }
      },
    }),
  ]
}
