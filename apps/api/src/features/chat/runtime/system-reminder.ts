/**
 * The envelope every reminder is written in.
 *
 * A leaf because two modules emit reminders now — the ones read off the transcript
 * (`reminders.ts`) and the one read off the run's own budget (`turn-budget-reminder.ts`) — and
 * a second copy of the tags is how the two would drift into emitting different envelopes for
 * the same channel. The agent is told in its system prompt that these tags are
 * system-generated and bear no relation to the surrounding content, so the tags themselves are
 * load-bearing: a body outside them reads as something a person wrote.
 */
export function wrapSystemReminder(lines: string[]): string {
  return ['<system-reminder>', ...lines, '</system-reminder>'].join('\n')
}
