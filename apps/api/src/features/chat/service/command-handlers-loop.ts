import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import type { ExistingMessages } from './run-agent'
import { splitCommandArg } from './slash-commands'
import { getLoopEngine } from '../../loops/runtime-binding'
import { LOOP_MAINTENANCE_PROMPT } from '../../loops/contracts'
import { plural } from '../../agent-core/tools/tool-output'

/**
 * Handles the `/loop …` control command. `list` replies directly; every other
 * form hands the AGENT an instruction to create the schedule itself via the
 * `Loops` tool — the model derives the 5-field cron from any cadence stated in
 * the task text (or omits it for a self-pacing dynamic loop), rephrases the
 * prompt as a single iteration, and runs the first iteration in the same turn.
 * (/loop is plain-text: there is no deterministic interval parser here — the
 * model owns the interval→cron conversion.) Runs via {@link CommandHandlerContext.runMacroCommand}
 * — the standard visible-command/hidden-instruction split — so the transcript
 * shows only the `/loop …` line the user typed (with a `commandOrigin` badge)
 * while the model receives the setup instruction as an internal message.
 */
export async function handleLoopControlCommand(
  ctx: Pick<CommandHandlerContext, 'runMacroCommand'>,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  allMessages: ExistingMessages,
  prompt: string,
  ts: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { runMacroCommand } = ctx
  const { value } = splitCommandArg(prompt)
  // Everything after `/loop ` with original casing preserved (for dynamic prompts).
  const afterCmd = prompt
    .trim()
    .replace(/^\/\S+\s*/, '')
    .trim()

  const engine = getLoopEngine()
  if (!engine) return directReply('Loop engine is not available.')

  // `/loop list` — show active loops.
  if (value === 'list') {
    const active = engine.list(userId, sessionId)
    if (active.length === 0) {
      return directReply(
        'No active loops. `/loop <task>` schedules one — state the cadence in the text ("cada 5 minutos …", "every hour …") for a fixed loop, or omit it for a self-pacing one.',
      )
    }
    const lines = active.map((l) => {
      const cadence = l.kind === 'dynamic' ? 'dynamic' : `\`${l.cron}\``
      const stats =
        l.runCount > 0 ? ` | ${plural(l.runCount, 'run')}, ${l.lastStatus ?? 'pending'}` : ''
      return `- \`${l.id.slice(0, 8)}\` | ${cadence}${l.target === 'subsession' ? ' | subsession' : ''}${stats} | ${l.prompt.slice(0, 60)}`
    })
    return directReply(
      `**Active loops (${active.length}):**\n${lines.join('\n')}\n\nCancel one from the composer strip or with \`Loops\`.`,
    )
  }

  // The stored job prompt must describe ONE iteration — the schedule owns the
  // repetition. Without this rule the model stores the user's phrasing verbatim
  // ("every minute say hi") and each fire re-reads a recurrence it must ignore.
  const PROMPT_RULE =
    'REPHRASE the stored prompt as a single-iteration imperative task: strip any recurrence phrasing ' +
    '("every minute", "cada minuto", "keep checking") — the schedule handles repetition — and make it self-contained ' +
    'per fire (e.g. "check new commits every minute and review them" → prompt "Check for commits pushed since the last run and review each new one."). ' +
    "Keep the task's own language."

  // No interval argument: the user writes the whole ask as plain text and the
  // AGENT derives the schedule (fixed cron when the text states a cadence,
  // dynamic self-pacing otherwise).
  const maintenance = afterCmd.length === 0
  const taskPrompt = maintenance ? LOOP_MAINTENANCE_PROMPT : afterCmd
  const instruction = [
    `[/loop] Set up a scheduled job with \`Loops\`, then run its first iteration now.`,
    `1. Derive the schedule FROM THE TASK TEXT: if it states a cadence ("every 5 minutes", "cada hora", "weekdays at 9am", "5m"), compute the 5-field cron yourself and pass it as \`cron\`. If it names NO cadence, omit \`cron\` — that creates a dynamic self-pacing loop.`,
    `2. ${PROMPT_RULE} Add target:"subsession" ONLY if the task itself says to run in a subsession.`,
    `3. Perform one iteration of the task now:`,
    ``,
    taskPrompt,
    ``,
    `4. If you created a DYNAMIC loop, finish by calling \`Loops\` action="reschedule" with the new job id and a delay_seconds you pick from what you observed (60–3600) — or \`Loops\` action="remove" if no further runs are useful. Skipping the reschedule does not stop it: it fires again after the same delay.`,
  ].join('\n')
  return runMacroCommand(userId, sessionId, session, allMessages, prompt.trim(), instruction, ts, {
    commandOrigin: { command: '/loop', label: maintenance ? 'maint' : 'auto' },
  })
}
