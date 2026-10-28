import type { SlashArgSpec } from './slash-args'
import type { SlashCommandSpec } from './slash-command-catalog'

/**
 * Claude Code's built-in commands that Localix runs by calling what it already has. Kept apart
 * from `slash-command-catalog.ts` (which spreads them in) so neither file outgrows its budget.
 * Each is a server command: it answers in the chat, on any surface.
 */

/** `/compact [instructions]`: what Claude Code's PreCompact hooks are told to focus on. */
const COMPACT_ARGS: SlashArgSpec[] = [
  {
    name: 'instructions',
    type: 'text',
    placeholder: 'What to keep in focus, or Enter to compact now…',
  },
]

/** `/add-dir <path>`: a folder the agent may then read and change like the project. */
const ADD_DIR_ARGS: SlashArgSpec[] = [
  {
    name: 'path',
    type: 'text',
    placeholder: 'A folder — absolute, relative to the project, or ~/…',
  },
]

/** `/export [filename]`: where to write the conversation; a default name otherwise. */
const EXPORT_ARGS: SlashArgSpec[] = [
  {
    name: 'filename',
    type: 'text',
    placeholder: 'A file in the project, or Enter for a Markdown file in the exports folder…',
  },
]

export const CLAUDE_CODE_COMMANDS: readonly SlashCommandSpec[] = [
  {
    name: 'compact',
    title: 'Compact',
    description:
      'Take a context checkpoint on the next message — /compact <instructions> tells PreCompact hooks',
    scope: 'server',
    category: 'context',
    args: COMPACT_ARGS,
  },
  {
    name: 'init',
    title: 'Init',
    description: 'Have the agent write a CLAUDE.md for this project, or improve the one it has',
    scope: 'server',
    category: 'memory',
    argless: true,
  },
  {
    name: 'status',
    title: 'Status',
    description: 'Show this chat’s version, model, folder, permission mode and extensions',
    scope: 'server',
    category: 'info',
    argless: true,
  },
  {
    name: 'hooks',
    title: 'Hooks',
    description: 'List the Claude Code hooks configured for this chat’s folder, by event',
    scope: 'server',
    category: 'extensions',
    argless: true,
  },
  {
    name: 'diff',
    title: 'Diff',
    description: 'Show the uncommitted changes in this chat’s folder, with git',
    scope: 'server',
    category: 'info',
    argless: true,
  },
  {
    name: 'add-dir',
    title: 'Add directory',
    description:
      'Let the agent work in another folder, as it does in the project — /add-dir <path>',
    scope: 'server',
    category: 'config',
    args: ADD_DIR_ARGS,
  },
  {
    name: 'export',
    title: 'Export',
    description: 'Write this conversation to a Markdown file — /export [filename]',
    scope: 'server',
    category: 'context',
    args: EXPORT_ARGS,
  },
]
