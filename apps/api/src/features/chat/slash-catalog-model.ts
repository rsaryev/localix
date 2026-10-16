import type { SlashArgSpec } from './slash-args'

/**
 * `/model` as the picker's own hierarchy, one step per column and in the same order:
 * Agents → Provider → Model → Settings (Reasoning, Turns per message, Context window).
 *
 * Every step is `dynamic`: its rows are the picker's live data (the room, the connections, the
 * connection's models, the levels THAT model offers), which only the composer holds. A surface
 * whose context does not apply skips a step (`parseCommandArgs`' `skip`): the agent step in a
 * one-agent chat, Reasoning for a model that does not reason, and the per-agent settings for
 * "All agents", exactly where the picker shows no such control. The settings are optional —
 * Enter applies what is chosen so far, as a pick in the picker does.
 *
 * Typed text still works: `/model <name>` reaches the server, which fuzzy-matches the name for
 * the participant the person is talking to (`command-handlers-settings.ts`).
 */
export const MODEL_ARGS: SlashArgSpec[] = [
  { name: 'agent', type: 'choice', dynamic: true, placeholder: 'Pick an agent, or All agents…' },
  { name: 'provider', type: 'choice', dynamic: true, placeholder: 'Pick a provider connection…' },
  { name: 'model', type: 'choice', dynamic: true, placeholder: 'Pick a model…' },
  {
    name: 'reasoning',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'Reasoning level — or Enter to apply…',
  },
  {
    name: 'turns',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'Turns per message — or Enter to apply…',
  },
  {
    name: 'context',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'Context window share — or Enter to apply…',
  },
]
