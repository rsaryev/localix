/**
 * webhook-notifier — POSTs agent lifecycle events to a configured URL.
 * Hooks-only: built entirely on the public PluginHooks contract. Best-effort
 * delivery (no retries) — a failure never breaks a turn.
 *
 * WHY IT REPORTS AND NOT JUST LOGS. Every delivery failure used to end in `ctx.log`,
 * which writes to the server console. The person who typed the URL is not reading the
 * server console: a typo in WEBHOOK_URL meant nothing was ever delivered, forever, and
 * the only evidence was a line nobody would see. `ctx.reportProblem` puts one sentence
 * in the chat the event came from — which is the one place the person is definitely
 * looking.
 *
 * ONCE PER RUN, NOT ONCE PER EVENT. A broken endpoint fails every hook, and seven
 * identical warnings per turn is noise that trains people to ignore the eighth. The
 * first failure for a session speaks; the rest go to the log as before, and the
 * session is allowed to speak again once a delivery has succeeded.
 */
import { createHmac } from 'node:crypto'

/** Every deliverable event; plugin.json's EVENTS description is checked against it. */
export const ALL_EVENTS = [
  'session_end',
  'user_message',
  'assistant_message',
  'tool_call',
  'hitl_request',
  'hitl_resolved',
  'subagent_stop',
  'human_assigned',
]
// Free-text fields are trimmed so a huge tool output can't balloon deliveries.
const PAYLOAD_FIELD_CAP = 4000

const trim = (v) =>
  typeof v === 'string' && v.length > PAYLOAD_FIELD_CAP
    ? `${v.slice(0, PAYLOAD_FIELD_CAP)}…[truncated]`
    : v

export function register(ctx) {
  const { helpers, config, log } = ctx
  // Sessions already told about a broken endpoint. Cleared on the next success, so a
  // URL that starts working again can go quiet and then speak up if it breaks twice, and
  // once the session's end has been delivered (or failed) — an ended chat is never asked
  // about again, so keeping it would grow the set for the life of the process.
  const reported = new Set()

  const reportOnce = (sessionId, message, detail) => {
    if (!sessionId || reported.has(sessionId)) return
    reported.add(sessionId)
    ctx.reportProblem?.({ sessionId, message, detail, source: 'delivery' })
  }

  const url = helpers.configString(config.WEBHOOK_URL, '')
  // The host, never the full URL: a webhook URL routinely carries a token in its path
  // or query, and `detail` ends up in a transcript a person may share.
  const endpoint = (() => {
    try {
      return new URL(url).host
    } catch {
      return 'the configured URL'
    }
  })()
  const timeoutMs = Math.max(1, helpers.configNumber(config.TIMEOUT_SECONDS, 5)) * 1000
  const secret = helpers.configString(config.SECRET, '')
  const eventsCsv = helpers.configString(config.EVENTS, '')
  const requested = eventsCsv.trim()
    ? eventsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ALL_EVENTS
  const selected = new Set(requested.filter((s) => ALL_EVENTS.includes(s)))
  // A typo in EVENTS otherwise silently disables delivery for that event with no
  // feedback — surface unknown names (and a fully-empty selection) at load.
  const unknown = requested.filter((s) => !ALL_EVENTS.includes(s))
  if (unknown.length)
    log(`ignoring unknown EVENTS: ${unknown.join(', ')} (valid: ${ALL_EVENTS.join(', ')})`)
  if (url && selected.size === 0) log('EVENTS matched no known events — nothing will be delivered')

  const deliver = (event, sessionId, payload) => {
    if (!url || !selected.has(event)) return
    const body = JSON.stringify({ event, sessionId, ts: new Date().toISOString(), payload })
    const headers = { 'content-type': 'application/json' }
    if (secret)
      headers['x-localix-signature'] = createHmac('sha256', secret).update(body).digest('hex')
    const t = helpers.withTimeoutSignal(undefined, timeoutMs)
    fetch(url, { method: 'POST', headers, body, signal: t.signal })
      // A rejected delivery is as lost as a failed one — a 404/500 endpoint would
      // otherwise look healthy forever.
      .then((res) => {
        if (res.ok) {
          reported.delete(sessionId)
          return
        }
        log(`delivery rejected (${event}): HTTP ${res.status}`)
        // The status is the operator's fact, not the person's. What they can act on is
        // that the endpoint is refusing their notifications.
        reportOnce(
          sessionId,
          'The webhook endpoint rejected this notification — check WEBHOOK_URL and the receiver',
          `${event}: HTTP ${res.status} from ${endpoint}`,
        )
      })
      .catch((err) => {
        const raw = err?.message ?? String(err)
        log(`delivery failed (${event}): ${raw}`)
        reportOnce(
          sessionId,
          'The webhook endpoint could not be reached — nothing is being delivered',
          `${event}: ${raw} (${endpoint})`,
        )
      })
      .finally(() => {
        t.dispose()
        if (event === 'session_end') reported.delete(sessionId)
      })
  }

  return {
    hooks: {
      onSessionEnd: (e) => {
        deliver('session_end', e.sessionId, {})
      },
      onUserMessage: (e) => {
        deliver('user_message', e.sessionId, { messageId: e.messageId, text: trim(e.text) })
      },
      onAssistantMessage: (e) => {
        deliver('assistant_message', e.sessionId, {
          messageId: e.messageId,
          content: trim(e.content),
        })
      },
      onPostToolCall: (e) => {
        deliver('tool_call', e.sessionId, { toolName: e.toolName, content: trim(e.result.content) })
      },
      onHumanAssigned: (e) => {
        deliver('human_assigned', e.sessionId, {
          messageId: e.messageId,
          from: e.from,
          text: trim(e.text),
        })
      },
      onHitlRequest: (e) => {
        deliver('hitl_request', e.sessionId, {
          requestId: e.requestId,
          kind: e.kind,
          toolName: e.toolName,
          title: e.title,
        })
      },
      onHitlResolved: (e) => {
        deliver('hitl_resolved', e.sessionId, {
          requestId: e.requestId,
          kind: e.kind,
          toolName: e.toolName,
          dismissed: Boolean(e.dismissed),
        })
      },
      onSubagentStop: (e) => {
        deliver('subagent_stop', e.sessionId, {
          childSessionId: e.childSessionId,
          status: e.status,
          durationMs: e.durationMs,
          summary: trim(e.summary),
        })
      },
    },
  }
}
