/**
 * `command.run` as Localix fires it: a mod's command typed in a conversation, or a mod's
 * `$.command.run`. Only mods answer it — a registered command has no core of its own — and their
 * `{ text }` is the command's output, shown in the conversation as a slash command's is in Claude
 * Code.
 */

export interface CommandInput {
  command: string
  args?: string
}

export interface CommandAnswer {
  text?: string
  context?: readonly string[]
}

export const commandRunEvent = (input: CommandInput) => ({
  command: input.command,
  args: input.args ?? '',
  origin: { kind: 'composer' },
  // The answer shows in the conversation, as a slash command's does in Claude Code.
  presentation: { isFullscreen: false, columns: 100 },
})

export const commandAnswer = (result: unknown): CommandAnswer =>
  (result && typeof result === 'object' ? result : {}) as CommandAnswer
