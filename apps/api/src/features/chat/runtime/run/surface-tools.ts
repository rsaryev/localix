import type { PersistedMessage } from '../../contracts'

/**
 * THE TOOLS AN OPEN PLUGIN BRINGS TO A TURN — on the wire while its view is in the conversation's
 * context, gone once it is not.
 *
 * A plugin's tools are deferred behind `activate_tools`, so an agent looking at an open board or
 * database tab still had to spend a call fetching the schema of the tool the tab was about —
 * the tab's context even LISTED the tool by name ("Useful agent tools: <the game's tool>"), as text. And
 * a tool once fetched, or brought by the plugin's own wake, stayed on the session for good: a
 * board closed an hour ago still sent its schema with every request. The rule is that a tool is
 * available while the context that makes it relevant holds, not from the first use on.
 *
 * Two things bring a plugin, both stamped by the host rather than claimed by the plugin:
 *
 * - A context binding the PERSON's message carries (`MessageContextBinding.plugin`, minted for a
 *   plugin tab's ambient link or drag). It is read from the latest message the person sent, not
 *   from whatever row the run answers: a sub-agent's report or a job's exit wakes the session
 *   with a row that carries no tabs, and reading only that row flipped the tool list off and on
 *   again between every report and reply — each flip a full prompt-cache miss. A tab the person
 *   closes, or a chip they remove, stops at their next message.
 * - A plugin's wake (`StoredMessagePayload.plugins`), for the rows this turn answers.
 *
 * Nothing here is written to the session: `session.activatedTools` stays what the model asked for.
 */

type Row = Pick<PersistedMessage, 'payload'>

const isPersonRow = (row: Row) =>
  row.payload.role === 'user' && !row.payload.isInternal && !row.payload.uiOnly

/** The rows this turn answers: the latest run of user rows, read back past the replies after it. */
export function answeredRows<T extends Row>(history: readonly T[]): T[] {
  let end = history.length
  while (end > 0 && history[end - 1]!.payload.role !== 'user') end--
  let start = end
  while (start > 0 && history[start - 1]!.payload.role === 'user') start--
  return history.slice(start, end)
}

/** The latest message the person sent, since the last `/clear`. */
function lastPersonRow(history: readonly Row[]): Row | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const row = history[index]!
    if (row.payload.contextBoundary) return undefined
    if (isPersonRow(row)) return row
  }
  return undefined
}

/** The plugins the turn brings: the person's open tabs, and the plugin that woke it. */
export function surfacePlugins(history: readonly Row[]): string[] {
  const fromTabs = (lastPersonRow(history)?.payload.bindings ?? []).flatMap((binding) =>
    binding.kind === 'context' && binding.plugin ? [binding.plugin] : [],
  )
  const fromWakes = answeredRows(history).flatMap((row) => row.payload.plugins ?? [])
  return [...new Set([...fromTabs, ...fromWakes])]
}

/**
 * Those plugins' tools, as each registered them on this load — resolved here rather than named
 * by the view, so a tab can never ask for a tool its plugin did not register, and a plugin whose
 * tool was renamed brings the new name. Sorted by NAME: the order the tabs happen to be ranked
 * in changes as the person moves focus, and a tool list that reorders is a cache miss that
 * changes nothing.
 */
export function surfaceTools(
  plugins: readonly string[],
  loaded: readonly { name: string; toolNames: readonly string[] }[],
): string[] {
  const wanted = new Set(plugins)
  const names = loaded.flatMap((plugin) => (wanted.has(plugin.name) ? plugin.toolNames : []))
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}
