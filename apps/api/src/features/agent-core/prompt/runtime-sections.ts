/**
 * THE VOLATILE TAIL of a run's system prompt.
 *
 * Everything from "# Runtime context" onward is per-turn or per-session: the date, the session
 * id, the MCP inventory, the person's new marks, scratch, sub-agents and loops. It never
 * rides the cached system prompt; the run carries it as the turn's runtime context inside the
 * conversation (`chat/runtime/model-view/turn-context.ts`).
 *
 * Each section is KEYED, and that is what lets the conversation stay append-only. A turn's
 * context is persisted where it was sent and never rewritten, so re-sending every section on
 * every turn would grow the history by the whole tail each turn; with keys, a turn sends only
 * the `state` sections that changed, while `turn` sections belong to the turn they arrive with.
 *
 * Which sections ride the tail is the catalog's to say (`catalog.ts`, tier `state` or `turn`): a
 * line added to the CACHED prefix costs every run its prefix on the turn the
 * fact changes, and a line added here costs nothing.
 */

/**
 * How the model reads the runtime context — stated once, in the cached prompt, because the
 * blocks themselves are deltas and a model that took an `update` for the whole picture would
 * believe every unmentioned section had gone away.
 */
export const RUNTIME_CONTEXT_PROTOCOL = [
  '# Context protocol',
  'Runtime facts (date, environment, jobs, loops, …) arrive inside the ' +
    'conversation in <runtime-context> blocks. A block without `update` is complete. An ' +
    '`update` block carries only the sections that changed since the previous block: the latest ' +
    'version of each section is current, and a section shown as "(no longer present)" is gone.',
  'A <context-checkpoint> message lists earlier stretches of the conversation that are outside ' +
    'your working view. It records what happened; it is not a request.',
].join('\n')

/**
 * One section of the runtime context. `state` is a standing fact (the jobs running, the loops):
 * it is re-sent only when its text changes, and the latest version is current. `turn` is about
 * THIS turn only (the skills its message triggered, the marks placed since the agent last
 * spoke) and is never carried forward.
 */
export interface RuntimeSection {
  key: string
  scope: 'state' | 'turn'
  text: string
}
