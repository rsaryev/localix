/**
 * WHAT THE VIEW ITSELF TELLS THE AGENT: the runtime sections that exist only because history is
 * shown through checkpoints.
 *
 * A checkpoint hides turns the model once saw, and two facts about that are said in the turn's
 * context rather than in the history, which is frozen:
 *
 *   near       — a checkpoint is a turn or two away, and what it will keep;
 *   pinned     — a message the person pinned is shown only in part by the checkpoint in force.
 *
 * One entry point, so the strategy composes these the way it composes every other section and no
 * caller has to know which of them apply on which turn.
 */
import type { ContextCheckpoint } from '@localixai/agent'

import type { RuntimeSection } from '../../../agent-core/system-prompt-tail'
import type { PersistedMessage } from '../../contracts'
import { pinnedOutOfViewSection } from './pins'
import type { ModelView } from './view'

/**
 * A `state` section: sent once, when the view crosses the warning mark, and gone with the full
 * render the checkpoint starts. Repeating it every turn would be a nag that costs tokens.
 */
function checkpointNearSection(): RuntimeSection {
  return {
    key: 'checkpoint-near',
    scope: 'state',
    text: [
      '# Context checkpoint ahead',
      'The conversation is close to a context checkpoint. After it, the oldest turns are shown ' +
        'only as short cards listing files, commands, errors and requests — not the reasons ' +
        'behind decisions.',
    ].join('\n'),
  }
}

export function modelViewSections(input: {
  view: ModelView
  /** The model-facing rows after the last `/clear`. */
  rows: readonly PersistedMessage[]
}): RuntimeSection[] {
  const { view, rows } = input
  // The record the rows are shown through this turn. On a checkpoint turn the old record is
  // still a faithful lower bound: a later checkpoint never un-evicts, so what it evicted stays
  // evicted, and the new checkpoint keeps every pin verbatim in its head.
  const record: ContextCheckpoint | undefined = view.checkpoint?.record
  const sections = [
    view.checkpointNear ? checkpointNearSection() : undefined,
    view.due ? undefined : pinnedOutOfViewSection(rows, record),
  ]
  return sections.filter((section): section is RuntimeSection => section !== undefined)
}
