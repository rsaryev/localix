import type { SlashArgSpec } from './slash-args'
import { MODEL_ARGS } from './slash-catalog-model'

/**
 * Arguments of the Claude Code spellings Localix runs as thin wrappers over what it already has.
 * Every choice is `dynamic`: its rows are live state (this person's chats, this chat's messages,
 * the command catalog) that the composer holds, and a typed value is accepted as a crumb.
 */

/** `/resume [chat]`: recent chats; an empty Enter opens the chat picker. */
export const RESUME_ARGS: SlashArgSpec[] = [
  {
    name: 'chat',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'A recent chat, or Enter to browse them…',
  },
]

/** `/rename <title>`: the new title of this chat. */
export const RENAME_ARGS: SlashArgSpec[] = [
  { name: 'title', type: 'text', placeholder: 'The new title of this chat…' },
]

/** `/rewind <message>`: one of this chat's messages, newest first. */
export const REWIND_ARGS: SlashArgSpec[] = [
  {
    name: 'message',
    type: 'choice',
    dynamic: true,
    placeholder: 'Pick the message to rewind to…',
  },
]

/** `/plan [task]`: switch to Plan mode, then send the task when there is one. */
export const PLAN_ARGS: SlashArgSpec[] = [
  { name: 'task', type: 'text', placeholder: 'A task to plan — or Enter to switch to Plan mode…' },
]

/** `/copy [reply]`: which assistant reply, newest first; the latest by default. */
export const COPY_ARGS: SlashArgSpec[] = [
  {
    name: 'reply',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'Which reply, or Enter for the latest…',
  },
]

const modelStep = (name: string) => MODEL_ARGS.find((arg) => arg.name === name)!
const reasoningStep = modelStep('reasoning') as Extract<SlashArgSpec, { type: 'choice' }>

/**
 * `/effort`: `/model`'s Agent and Reasoning steps, for the model the agent already runs on. The
 * rows are `/model`'s own (`model-command/modelCommandSteps.ts`); Reasoning is required here
 * because there is nothing else to apply.
 */
export const EFFORT_ARGS: SlashArgSpec[] = [
  modelStep('agent'),
  { ...reasoningStep, optional: false, placeholder: 'Pick a reasoning level…' },
]

/** `/help [command]`: the commands it can describe. */
export const HELP_ARGS: SlashArgSpec[] = [
  {
    name: 'command',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'A command, or Enter to list them all…',
  },
]

/** `/output-style [style]`: the styles this chat can pick, or default. */
export const OUTPUT_STYLE_ARGS: SlashArgSpec[] = [
  {
    name: 'style',
    type: 'choice',
    dynamic: true,
    optional: true,
    placeholder: 'A style, default, or Enter to list the styles…',
  },
]

/** `/memory [fact]`: the fact to remember; empty lists the saved ones. */
export const MEMORY_ARGS: SlashArgSpec[] = [
  { name: 'fact', type: 'text', placeholder: 'A fact to remember, or Enter to list memories…' },
]
