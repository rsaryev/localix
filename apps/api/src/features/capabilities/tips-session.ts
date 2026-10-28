import type { CuratedTip } from './tips-curated'
import { insertAction, storeAction } from './tips-actions'

/**
 * Tips about the LIVE SESSION — the ones that are advice at a particular moment and
 * noise at every other.
 *
 * "Pin what must stay in view" is useful at eighty percent of the context window and
 * pointless on turn two. The server cannot see that, so each entry names the signal
 * it needs (`TIP_SIGNALS`) and the client answers whether it holds. That is also what
 * makes a longer pool safe: a tip that can only appear in its moment does not compete
 * with the rest for airtime, so adding one costs nothing at every other moment.
 *
 * Ranking follows from the same data — a gate naming a signal is more specific than
 * one naming nothing, and `pickStreamTip` prefers the most specific match — so these
 * win over the generic pool exactly when they apply.
 */
export const SESSION_TIPS: readonly CuratedTip[] = [
  {
    id: 'session:queue-order',
    text: 'Queued messages run in order after this turn — you can reorder or drop them above.',
    when: { signals: ['queue-nonempty'] },
  },
  {
    id: 'session:context-tight',
    text: 'Near the context limit, older turns leave the model’s view on their own — pin a message to keep it in view.',
    when: { signals: ['context-tight'] },
  },
  {
    id: 'session:fork-instead',
    text: 'Long thread? Fork it and the new branch starts from here without the rest of the history.',
    when: { signals: ['session-long'], notSignals: ['context-tight'] },
    actions: [insertAction('/fork')],
  },
  {
    id: 'session:loops-armed',
    text: 'A loop is armed on this session — it wakes the agent on its own schedule until you stop it.',
    when: { signals: ['loops-active'] },
  },
  {
    id: 'session:monitors-armed',
    text: 'A monitor is watching for you — it wakes this session when what it watches changes.',
    when: { signals: ['monitors-active'] },
  },
  {
    id: 'session:long-run-queue',
    text: 'Still working — you can keep typing; your next message goes in the queue, not on top.',
    when: { signals: ['run-long'], notSignals: ['queue-nonempty'] },
  },
  {
    id: 'session:long-run-background',
    text: 'Work that outlives a turn belongs in the background — ask, and the run stops waiting on it.',
    requiresAnyTool: ['Bash'],
    when: { signals: ['run-long'] },
  },
  // ── Someone's first sessions ──────────────────────────────────────────────
  {
    id: 'session:first-project',
    text: 'A project points the agent at a folder — everything it reads and writes stays inside it.',
    when: { signals: ['first-session'] },
  },
  {
    id: 'session:first-agents',
    text: 'You can keep several agents, each with its own model, prompt and rules.',
    when: { signals: ['first-session'] },
    actions: [storeAction('agent', 'Open Agents')],
  },
  {
    id: 'session:first-interrupt',
    text: 'Esc stops a run where it stands — nothing it already wrote is rolled back.',
    when: { signals: ['first-session'] },
  },
]
