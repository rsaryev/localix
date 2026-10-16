import { loopClockTime, loopLastStatusLabel } from '../../loops/format'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../tool-names'
import { classifyLoopsCall } from './loops-call-class'
import { getLoopEngine } from '../../loops/runtime-binding'
import { isValidCron } from '../../triggers/schedule'
import { resolveLoopId } from '../../loops/resolve-id'
import {
  DYNAMIC_MAX_DELAY_SECONDS,
  DYNAMIC_MIN_DELAY_SECONDS,
  type SessionLoop,
} from '../../loops/contracts'
import { plural } from './tool-output'

export interface LoopsToolOptions {
  userId: string
  sessionId: string
  /** The participant calling it: a loop it arms is its own, and its fires are addressed to it. */
  agentId: string
}

const inputSchema = z.object({
  action: z
    .enum(['add', 'list', 'get', 'update', 'remove', 'run', 'reschedule'])
    .describe(
      '"add" — schedule a job (with `cron` for a fixed cadence, without for a self-pacing dynamic loop). ' +
        '"list" — all jobs of this session. "get" — one job with full detail. ' +
        '"update" — change a job\'s prompt/cron/target. "remove" — delete a job. ' +
        '"run" — fire a job immediately (extra occurrence; the schedule is untouched). ' +
        '"reschedule" — set a DYNAMIC job\'s next delay (call at the end of each dynamic iteration).',
    ),
  id: z.string().optional().describe('Job id — required for get/update/remove/run/reschedule.'),
  cron: z
    .string()
    .optional()
    .describe(
      '5-field cron in LOCAL server time, e.g. "*/5 * * * *", "0 9 * * 1-5". For add: present = fixed job, absent = dynamic. For update: replaces the cadence (converts a dynamic job to fixed).',
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      'Task run on EACH fire (required for add; optional for update). Phrase it as a SINGLE-iteration imperative task — never include recurrence wording ("every minute", "keep checking"): the schedule owns repetition. Make it self-contained per fire, e.g. user asks "review new commits every 5 minutes" → prompt "Check for commits pushed since the last run and review each new one." Keep the user\'s language.',
    ),
  target: z
    .enum(['session', 'subsession'])
    .optional()
    .describe(
      'Where fires run. "session" (default) injects the task into THIS session. "subsession" runs EVERY fire in a fresh child session — use it for noisy/frequent jobs so this session\'s history stays flat. Fixed (cron) jobs only.',
    ),
  delay_seconds: z
    .number()
    .optional()
    .describe(
      `Seconds until the next fire (required for action=reschedule; clamped to ${DYNAMIC_MIN_DELAY_SECONDS}–${DYNAMIC_MAX_DELAY_SECONDS}).`,
    ),
})

function cadence(l: SessionLoop): string {
  if (l.kind === 'dynamic')
    return l.delaySeconds ? `dynamic · ~${Math.round(l.delaySeconds / 60)}m` : 'dynamic'
  return `\`${l.cron}\``
}

const shortTime = (iso: string): string => loopClockTime(iso)

function statsLine(l: SessionLoop): string {
  if (l.runCount === 0) return 'not fired yet'
  const last = l.lastRunAt ? shortTime(l.lastRunAt) : '?'
  // "delivered" vs "completed" is not cosmetic: for a session loop the recorded status only says
  // the wake was ENQUEUED, so printing a bare "ok" told the agent the run had gone fine.
  const status =
    l.lastStatus === 'error'
      ? `error${l.lastError ? ` (${l.lastError.slice(0, 120)})` : ''}`
      : loopLastStatusLabel(l)
  return `${plural(l.runCount, 'run')} · last ${last} → ${status}`
}

function formatJob(l: SessionLoop): string {
  const next = shortTime(l.nextRunAt)
  const target = l.target === 'subsession' ? ' · subsession' : ''
  return `- **${l.id}** · ${cadence(l)}${target} · next: ${next} · ${statsLine(l)}\n  > ${l.prompt.slice(0, 100)}`
}

function formatJobDetail(l: SessionLoop): string {
  const next = shortTime(l.nextRunAt)
  return [
    `**${l.id}**`,
    `- kind: ${l.kind} · cadence: ${cadence(l)} · target: ${l.target}`,
    `- next: ${next} · created: ${shortTime(l.createdAt)}`,
    `- stats: ${statsLine(l)}`,
    `- prompt:\n  > ${l.prompt}`,
  ].join('\n')
}

/**
 * The single `loops` tool — one action enum instead of separate create/list/delete
 * tools. Manages this session's loops: fixed 5-field-cron jobs, self-pacing dynamic
 * loops, and per-job fire target (this session vs a fresh subsession per fire). Backed
 * by the durable loop engine (resolved via runtime-binding so agent-core stays
 * decoupled from the chat feature). The call semantics live HERE, in the schema; the
 * prompt's `# Loops` section only says when a loop's run arrives and what to do with it.
 */
export function createLoopsTool(opts: LoopsToolOptions) {
  return defineAgentTool({
    name: TOOL.loops,
    description:
      'Schedule and manage recurring jobs for THIS session. The action and parameter fields describe fixed and dynamic job mechanics. ' +
      'Reschedule/update the existing job by id — never add a second job for the same task.',
    activeVerb: 'Managing loops',
    inputSchema,
    // Schedules DURABLE work: add/update/remove rewrite the schedule and `run` fires a
    // job immediately. Declaring this is what puts those behind an `ask` rule's prompt.
    mutates: true,
    classify: classifyLoopsCall,
    executionMode: 'sequential',
    async execute(_toolCallId, input, _signal, _onUpdate, _context) {
      const engine = getLoopEngine()
      if (!engine) return { content: 'Loop engine is not available.', isError: true }

      // Id-scoped actions may only touch a job owned by THIS session (the engine
      // gates by user; cross-session management is refused here). Callers may pass
      // the full id OR a unique case-insensitive prefix (≥6 chars) of one of this
      // session's loops — the human-facing `/loop list` shows an 8-char short id,
      // so quoting that must resolve. Returns the loop or a ready-to-return error.
      const ownedInSession = (): SessionLoop[] =>
        engine.list(opts.userId, opts.sessionId).filter((l) => l.sessionId === opts.sessionId)
      const resolve = (rawId: string): { loop: SessionLoop } | { error: string } => {
        // Exact full-id match first (also guards the session boundary that
        // `engine.get` alone would not — a full id from another session is refused).
        const exact = engine.get(rawId, opts.userId)
        if (exact && exact.sessionId === opts.sessionId) return { loop: exact }

        const res = resolveLoopId(rawId, ownedInSession())
        if (res.kind === 'match') return { loop: res.loop }
        if (res.kind === 'ambiguous') {
          const candidates = res.candidates.map((l) => `\`${l.id}\``).join(', ')
          return {
            error: `Ambiguous id \`${rawId}\` — matches ${res.candidates.length} jobs: ${candidates}. Use more characters (or the full id).`,
          }
        }
        return { error: `No loop \`${rawId}\` in this session.` }
      }

      switch (input.action) {
        case 'list': {
          const active = engine.list(opts.userId, opts.sessionId)
          if (active.length === 0) return { content: 'No loops in this session.' }
          return {
            content: `**Loops (${active.length}):**\n\n${active.map(formatJob).join('\n')}`,
          }
        }

        case 'get': {
          if (!input.id) return { content: 'Provide `id` to get.', isError: true }
          const r = resolve(input.id)
          if ('error' in r) return { content: r.error, isError: true }
          return { content: formatJobDetail(r.loop) }
        }

        case 'add': {
          if (!input.prompt) return { content: 'Provide `prompt` to add a job.', isError: true }
          // An impossible COMBINATION is checked before the duplicate report: answering
          // "that job already exists" would send the model off to `update` a job that cannot express
          // what it just asked for, hiding the real reason its request is refused.
          if (!input.cron && input.target === 'subsession') {
            return {
              content:
                'A dynamic (no-cron) loop cannot run in a subsession — it must reschedule itself from this session. Give it a `cron` cadence, or drop `target`.',
              isError: true,
            }
          }
          // IDEMPOTENCY, in code rather than in the description. `engine.create`/`createDynamic`
          // mint a fresh id per call, so an ambiguous failure (run aborted or tool result lost
          // after the DB write) followed by a re-issued identical call left TWO jobs firing
          // forever; a prompt is not an idempotency key. The key is what makes two calls "the same
          // job" to a user — this session, the same cadence (or dynamic), the same prompt and the
          // same `target` (a job firing here and one firing in a subsession are different jobs) —
          // and returning the EXISTING id is what a retry wants, so `reschedule`/`update` still
          // work. Every listed loop is live (a dynamic loop re-arms after every fire and ends only
          // when removed), so matching a listed one never hands back a corpse's id.
          const duplicate = ownedInSession().find(
            (loop) =>
              loop.prompt === input.prompt &&
              (loop.cron ?? null) === (input.cron ?? null) &&
              loop.target === (input.target ?? 'session'),
          )
          if (duplicate) {
            return {
              content:
                `That job already exists — id: \`${duplicate.id}\`. Nothing was added.\n` +
                `${formatJob(duplicate)}\n` +
                `If you meant to change it, use action="update" or action="reschedule" with that id.`,
            }
          }
          if (input.cron) {
            if (!isValidCron(input.cron))
              return { content: `Invalid cron: "${input.cron}".`, isError: true }
            const result = await engine.create({
              userId: opts.userId,
              sessionId: opts.sessionId,
              cron: input.cron,
              prompt: input.prompt,
              target: input.target ?? 'session',
              ownerAgentId: opts.agentId,
            })
            if ('error' in result) return { content: result.error, isError: true }
            return { content: `Loop added:\n${formatJob(result)}` }
          }
          const result = await engine.createDynamic({
            userId: opts.userId,
            sessionId: opts.sessionId,
            prompt: input.prompt,
            ownerAgentId: opts.agentId,
          })
          if ('error' in result) return { content: result.error, isError: true }
          return {
            content: `Dynamic loop added — id: \`${result.id}\`. Do the work, then call \`loops\` with action="reschedule", id="${result.id}", and a \`delay_seconds\` to schedule the next run. Until you do, it fires again at ${shortTime(result.nextRunAt)}; remove it when it is no longer useful.`,
          }
        }

        case 'update': {
          if (!input.id) return { content: 'Provide `id` to update.', isError: true }
          const r = resolve(input.id)
          if ('error' in r) return { content: r.error, isError: true }
          if (
            input.prompt === undefined &&
            input.cron === undefined &&
            input.target === undefined
          ) {
            return {
              content: 'Provide at least one of `prompt`, `cron`, `target` to update.',
              isError: true,
            }
          }
          const result = await engine.update(r.loop.id, opts.userId, {
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(input.cron !== undefined ? { cron: input.cron } : {}),
            ...(input.target !== undefined ? { target: input.target } : {}),
          })
          if ('error' in result) return { content: result.error, isError: true }
          return { content: `Loop updated:\n${formatJob(result)}` }
        }

        case 'remove': {
          if (!input.id) return { content: 'Provide `id` to remove.', isError: true }
          const r = resolve(input.id)
          if ('error' in r) return { content: r.error, isError: true }
          const ok = await engine.cancel(r.loop.id, opts.userId)
          return ok
            ? { content: `Loop \`${r.loop.id}\` removed.` }
            : { content: `Loop \`${r.loop.id}\` not found.`, isError: true }
        }

        case 'run': {
          if (!input.id) return { content: 'Provide `id` to run.', isError: true }
          const r = resolve(input.id)
          if ('error' in r) return { content: r.error, isError: true }
          const result = await engine.runNow(r.loop.id, opts.userId)
          if ('error' in result) return { content: result.error, isError: true }
          const where =
            result.target === 'subsession'
              ? 'in a fresh subsession'
              : 'in this session (queued behind the current turn)'
          return {
            content: `Loop \`${r.loop.id}\` fired now ${where}. The schedule is unchanged (next: ${shortTime(result.nextRunAt)}).`,
          }
        }

        case 'reschedule': {
          if (!input.id) return { content: 'Provide `id` to reschedule.', isError: true }
          if (input.delay_seconds == null)
            return { content: 'Provide `delay_seconds` to reschedule.', isError: true }
          const r = resolve(input.id)
          if ('error' in r) return { content: r.error, isError: true }
          const res = await engine.reschedule(r.loop.id, opts.userId, input.delay_seconds)
          if ('error' in res) return { content: res.error, isError: true }
          return {
            content: `Loop \`${r.loop.id}\` rescheduled — next run in ~${Math.round(res.appliedSeconds / 60)}m (${shortTime(res.loop.nextRunAt)}).`,
          }
        }
      }
      return { content: 'Unknown action.', isError: true }
    },
  })
}
