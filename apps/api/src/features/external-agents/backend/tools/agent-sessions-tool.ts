/**
 * The `external_agent_sessions` tool body: validate → fix-it → act → render.
 *
 * Purely read-only: every action answers a question about a session and none of them mutates
 * anything, here or in another agent's files. It also never starts an agent — the plugin's
 * `/claude` and `/codex` commands drive a CLI in a terminal, and a second way to launch one would
 * be a second thing to keep correct.
 */

import type { AgentSessionsInput } from './agent-sessions-schema'
import { agentSessionsProblem } from './agent-sessions-schema'
import type { AgentSessionsService } from '../service'
import { DEFAULT_WAIT_STATES } from '../live/waiters'
import type { RosterRow } from '../../shared/contracts'
import { formatQuota, quietMinutes, quotaIsCurrent } from '../../shared/contracts'
import { toolNameOf, toolNamesByCallId } from '../transcript/tool-names'
import { renderAgentSessionStats } from './agent-sessions-stats'

/**
 * Rows rendered into the model's context are capped well below the HTTP limit. The UI can page
 * through 200 rows cheaply; a model paying per token cannot, and 40 is enough to choose from or to
 * learn that the filter needs narrowing.
 */
const MODEL_ROW_LIMIT = 40

/**
 * A call's arguments, as the provider recorded them.
 *
 * Bounded here because `maxCharsPerEvent` clips an event's TEXT and never touched `toolInput`: a
 * single `Write` call can carry a whole file, and one of those would eat the answer a model asked
 * for. Unserializable input degrades to nothing rather than to `[object Object]`.
 */
const CALL_ARGS_CHARS = 600

function callArguments(input: unknown): string {
  let json: string | undefined
  try {
    json = JSON.stringify(input)
  } catch {
    json = undefined
  }
  if (!json) return '(arguments not readable)'
  return json.length > CALL_ARGS_CHARS ? `${json.slice(0, CALL_ARGS_CHARS)}…` : json
}

/**
 * One roster row, in the ~40 rows a model can afford to read.
 *
 * The SIZE is here because this list is how a key gets chosen, and the next call spends context in
 * proportion to it: reading a 3,000-event session to answer a question the 12-event one beside it
 * would have answered is the mistake this row exists to prevent. `messageCount` falls out of the
 * summary pass at no extra cost and is present on nearly every session.
 *
 * `unconfirmed` says the state is the manifest's no-match fallback rather than a reading. It rides
 * on the row because the alternative is a second `explain` call per row just to learn whether the
 * first answer meant anything, and because `idle` is the state a caller acts on by stopping.
 *
 * `awaited` says another orchestrator's `wait` is blocked on this session right now. The workspace
 * row has shown it since `waitedKeys` existed; the model, which is the half that issues waits, could
 * not see it.
 */
function renderRow(row: RosterRow): string {
  const marks: string[] = [row.state]
  if (row.terminalId) marks.push('live')
  if (row.awaited === true) marks.push('awaited')
  // The state is the no-match fallback. A model that reads `idle` and stops waiting on the
  // strength of it needs to know nothing confirmed it — claude-code cannot report `working` at all.
  if (row.stateFallback === true) marks.push('unconfirmed')
  /**
   * How long the screen has been still. A row reading `idle · unconfirmed` says only that no rule
   * matched; this says whether the agent has done anything visible since, which is what separates a
   * finished delegation from a stuck one. Symphony calls the same measure a stall and retries on it.
   */
  const quiet = row.terminalId ? quietMinutes(row.lastChangeAt, Date.now()) : undefined
  if (quiet !== undefined) marks.push(`unchanged for ${quiet}m`)
  const when = new Date(row.updatedAt).toISOString().slice(0, 16).replace('T', ' ')
  const size = row.messageCount === undefined ? '' : ` · ${row.messageCount} events`
  return [
    `- ${row.key}`,
    `    ${row.title}`,
    `    ${marks.join(' · ')} · updated ${when}${size}${row.cwd ? ` · ${row.cwd}` : ''}`,
  ].join('\n')
}

export async function runAgentSessions(
  service: AgentSessionsService,
  input: AgentSessionsInput,
  signal?: AbortSignal,
  /** The chat session asking. Required to read a terminal — the host checks it owns the pane. */
  sessionId?: string | null,
): Promise<{ content: string }> {
  const problem = agentSessionsProblem(input)
  if (problem) return { content: problem }

  switch (input.action) {
    case 'providers': {
      const providers = await service.providers()
      const lines = providers.map((p) => {
        const roots = p.roots.map((r) => `${r.path}${r.exists ? '' : ' (absent)'}`).join(', ')
        const flags = [
          p.verified ? 'verified' : 'UNVERIFIED adapter',
          p.error ? `error: ${p.error}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
        // Both populations, named: a bare total that silently included sub-agent transcripts read as
        // "you have 1706 sessions" beside a roster showing 123.
        const nested = p.childSessionCount
          ? ` (+${p.childSessionCount} sub-agent transcript(s))`
          : ''
        // The account's own limits, where the provider records any. A model deciding whether to
        // launch another agent is asking this and has had no way to find out. Every window is
        // listed: with two open, the weekly can read 7% while the 5-hour one reads 45%, and a single
        // figure would be whichever the provider happened to list first.
        // Only windows still running: an expired reading describes our own staleness, not the
        // account, and a stored 5-hour reading can be weeks old.
        const quota = (p.quotas ?? [])
          .filter((reading) => quotaIsCurrent(reading, Date.now()))
          .map((reading) => `\n    quota: ${formatQuota(reading, Date.now())}`)
          .join('')
        return `- ${p.provider} (${p.displayName}): ${p.sessionCount} session(s)${nested} · ${flags}\n    roots: ${roots}${quota}`
      })
      return { content: `Providers:\n${lines.join('\n')}` }
    }

    case 'stats': {
      const stats = await service.stats({
        ...(input.providers ? { providers: input.providers } : {}),
        ...(input.days === undefined ? {} : { days: input.days }),
        ...(input.cwdPrefix ? { cwdPrefix: input.cwdPrefix } : {}),
        ...(input.model ? { model: input.model } : {}),
      })
      return renderAgentSessionStats(stats, input)
    }

    case 'roster': {
      // No session id: the roster is machine-wide, and every row it returns is addressable by key
      // from anywhere. Passing the asking session would suggest a scoping that does not exist.
      const result = await service.roster({
        text: input.text,
        providers: input.providers,
        states: input.states,
        ...(input.cwdPrefix ? { cwdPrefix: input.cwdPrefix } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.parentKey ? { parentKey: input.parentKey } : {}),
        offset: input.offset,
        limit: Math.min(input.limit ?? MODEL_ROW_LIMIT, MODEL_ROW_LIMIT),
        ...(input.includeChildren === undefined ? {} : { includeChildren: input.includeChildren }),
      })
      if (result.items.length === 0) {
        return {
          content:
            'No external agent sessions matched. Try { action: "providers" } to see which histories were found on this machine.',
        }
      }
      const withheld =
        result.withheld > 0
          ? `\n\n${result.items.length} of ${result.total} shown; ${result.withheld} not shown. Narrow with "text"/"providers"/"states", or page with "offset".`
          : `\n\nAll ${result.total} matching session(s) shown.`
      return { content: `${result.items.map(renderRow).join('\n')}${withheld}` }
    }

    case 'explain': {
      // Take a READING before explaining, when the host allows it. Otherwise the answer is
      // whatever the model last happened to look at, which is exactly the staleness `explain`
      // exists to make visible.
      await service.readScreen(input.key as string, sessionId ?? null)
      const explain = await service.explain(input.key as string)
      if (!explain) {
        return {
          content: `No live delegation for ${input.key}, so there is no live state to explain. Historical sessions have no lifecycle state.`,
        }
      }
      const rows = [
        `state: ${explain.state}`,
        `authority: ${explain.authority}`,
        explain.matchedRule ? `matched rule: ${explain.matchedRule}` : null,
        explain.manifestId
          ? `manifest: ${explain.manifestId}${explain.manifestOverridden ? ' (local override)' : ''}`
          : null,
        explain.fallbackReason ? `fallback: ${explain.fallbackReason}` : null,
        `observed: ${new Date(explain.observedAt).toISOString()}`,
      ].filter(Boolean)
      return { content: `${explain.summary}\n\n${rows.join('\n')}` }
    }

    case 'resume': {
      const result = await service.resume(input.key as string)
      if (!result) return { content: `No session on disk for ${input.key}.` }
      if (!result.resume)
        return {
          content: `Native terminal continuation is not supported for ${input.key}. You can read its transcript or import it in Localix.`,
        }
      return {
        content: `To open this exact session in ${result.resume.providerName}, run bash with ${JSON.stringify({ action: 'open', command: result.resume.command })}. This lookup has not opened a terminal; execute that command before reporting the session as opened.`,
      }
    }

    case 'transcript': {
      const slice = await service.transcript(
        input.key as string,
        input.maxEvents,
        undefined,
        input.tail,
        input.from,
      )
      if (!slice) return { content: `No transcript on disk for ${input.key}.` }
      // WHICH end was read, always — the same events count means two different things depending on
      // it, and a model handed the opening of a session while expecting its end has no way to tell.
      // With `from` the window began at neither end, so neither word is true of it.
      const end =
        input.from !== undefined
          ? `position ${slice.events[0]?.ordinal ?? input.from}`
          : input.tail
            ? 'the end'
            : 'the start'
      /**
       * Name the way to what is missing, with the number.
       *
       * This offered the OTHER END only, which for a long session is not enough: 8,596 events with
       * 2,000 shown leaves thousands that neither end reaches. `from` closes that, so the sentence
       * says where to continue rather than only that something was withheld.
       */
      const first = slice.events[0]?.ordinal
      const last = slice.events[slice.events.length - 1]?.ordinal
      const next =
        first === undefined || last === undefined
          ? undefined
          : input.tail
            ? Math.max(0, first - slice.events.length)
            : last + 1
      const withheld =
        slice.withheld > 0
          ? ` (${slice.withheld} withheld — continue with from: ${next ?? 0}${
              input.tail ? '' : `, or read the end with tail:true`
            })`
          : ''
      const head = `${slice.summary.provider} — ${slice.summary.title}\nsource: ${slice.summary.sourcePath}\nevents: ${slice.events.length} of ${slice.total}, from ${end}${withheld}`
      // Name the tool, rather than labelling every result `tool` and leaving the model to infer
      // which call it belongs to from adjacency. A result carries the call's id and not its name, so
      // the name is looked up across the whole slice — including calls this window shows above the
      // fold. Never invented: an id with no call here stays a bare `tool`.
      const toolNames = toolNamesByCallId(slice.events)
      const body = slice.events
        .map((event) => {
          const named = toolNameOf(event, toolNames)
          const label = named ? `${event.role}:${named}` : event.role
          // A CALL's text is the adapters' placeholder — the tool's own name — so printing it beside
          // a label that already says the name spends a line to repeat itself. The arguments are
          // what a reader wants there, and this renderer was dropping them entirely even though
          // every adapter records them.
          const text =
            event.toolInput !== undefined && event.text === named
              ? callArguments(event.toolInput)
              : event.text
          return `**${label}**: ${text}`
        })
        .join('\n\n')
      return { content: `${head}\n\n${body}` }
    }

    case 'context': {
      const result = await service.context(input.keys as string[], input.budgetChars, input.tail)
      if (result.sections.length === 0) {
        return { content: 'None of those keys resolved to a transcript on disk.' }
      }
      return { content: result.text }
    }

    case 'wait': {
      const outcome = await service.wait(
        {
          keys: input.keys as string[],
          mode: input.mode ?? 'any',
          until: input.until?.length ? input.until : DEFAULT_WAIT_STATES,
          timeoutMs: input.timeoutMs ?? 120_000,
        },
        signal,
        sessionId ?? null,
      )
      return { content: outcome.summary }
    }
  }
}
