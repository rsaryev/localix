/**
 * The copy for the run-lifecycle phases the host announces by CODE on `agent.phase`.
 *
 * The host says WHAT it is doing (`thinking`, `generating-title`); how that reads to a person
 * is this client's decision — its language, its tone, its length. A phase whose text is data
 * (a terminal wait naming the command it is waiting on) still arrives with a `label`, and that
 * label wins. An unknown code is shown as the code, so a new host phase is visible before this
 * map learns it rather than silently blank.
 */
const PHASE_COPY: Readonly<Record<string, string>> = {
  connecting: 'Connecting',
  'preparing-context': 'Loading memory & skills',
  thinking: 'Thinking',
  'generating-title': 'Generating title',
}

export function phaseCopy(phase: string, label?: string): string {
  return label ?? PHASE_COPY[phase] ?? phase
}
