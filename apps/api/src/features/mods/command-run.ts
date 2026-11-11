/**
 * `command.run` as Localix fires it through the kit's `runCommand`: a mod's command typed in a
 * conversation, or a mod's `$.command.run`. Only mods answer it — a registered command has no core
 * of its own — and their `{ text }` is the command's output, shown in the conversation as a slash
 * command's is in Claude Code. The kit fires it as `{ command, args }`: no `origin` or
 * `presentation` (scripts/cc-parity/known-gaps.json).
 */

export interface CommandInput {
  command: string
  args?: string
}

export interface CommandAnswer {
  text?: string
  context?: readonly string[]
}

export const commandAnswer = (result: unknown): CommandAnswer =>
  (result && typeof result === 'object' ? result : {}) as CommandAnswer
