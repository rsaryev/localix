import type { CommandOrigin } from '@rsaryev/llx-plugin/mods'

/**
 * `command.run` as Localix fires it through the kit's `runCommand`: a mod's command typed in a
 * conversation, or a mod's `$.command.run`. Only mods answer it — a registered command has no core
 * of its own — and their `{ text }` is the command's output, shown in the conversation as a slash
 * command's is in Claude Code. The kit adds `presentation` (the desktop measures no grid: the main
 * screen at 80 columns) and the `origin` given here, `unclassified` when none is.
 */

export interface CommandInput {
  command: string
  args?: string
  /** Who ran it, in `prompt.submit`'s words: `composer` for the person's own Enter. */
  origin?: CommandOrigin
}

export interface CommandAnswer {
  text?: string
  context?: readonly string[]
}

export const commandAnswer = (result: unknown): CommandAnswer =>
  (result && typeof result === 'object' ? result : {}) as CommandAnswer
