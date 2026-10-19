/**
 * The HTTP side of a session E2E runtime: calls into the API, the scripted provider's request log,
 * and the session helpers scenarios drive conversations with. Shared by both runtimes in
 * `harness.mjs` — the isolated one with a scripted model and one attached to a running API.
 */
import { existsSync, readFileSync } from 'node:fs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createClient(base, requestLog) {
  /** One API call; `{ status, body }` without throwing, for the cases that expect a refusal. */
  async function call(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}/rpc${route}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-localix-client': 'session-e2e' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    let parsed
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    return { status: response.status, body: parsed }
  }
  async function api(route, body, method) {
    const result = await call(route, body, method)
    if (result.status >= 400)
      throw new Error(
        `${method ?? (body ? 'POST' : 'GET')} ${route}: ${result.status} ${JSON.stringify(result.body)}`,
      )
    return result.body
  }
  /**
   * Every request the model was sent, oldest first; narrowed by session and speaker. A session is
   * named by its reference (`LOCALIX-<seq>`), the id the runtime context gives the model — pass
   * the session itself and its reference is used.
   */
  function requests({ session, sessionId = session && `LOCALIX-${session.seq}`, speaker } = {}) {
    // Attached to a real provider there is no log: only what a person sees can be asserted.
    if (!requestLog || !existsSync(requestLog)) return []
    return readFileSync(requestLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (entry) =>
          (!sessionId || entry.sessionId === sessionId) && (!speaker || entry.speaker === speaker),
      )
  }
  return { base, call, api, requests }
}

/**
 * Session helpers over a client. `routes` is the route every agent the harness knows runs on —
 * seated or not, so an invited agent answers on it too. `created` collects every session opened,
 * for a runtime that must remove them afterwards.
 */
export function sessionHelpers(runtime, { connectionId, modelId }, agentIds, created = []) {
  const { api, call, requests } = runtime
  /** Every agent the harness knows, seated or not, on the scripted model: an invited one joins on it. */
  const routeEveryone = (sessionId) =>
    api(
      `/sessions/${sessionId}`,
      {
        routes: Object.values(agentIds).map((agentId) => ({
          agentId,
          providerConnectionId: connectionId,
          modelId,
          reasoningEffort: 'low',
        })),
      },
      'PATCH',
    )

  async function createSession({ handles = ['localix'], ...input } = {}) {
    const session = await api('/sessions', {
      title: input.title ?? 'Session E2E',
      agentIds: handles.map((handle) => agentIds[handle]),
      ...input,
    })
    created.push(session.id)
    await routeEveryone(session.id)
    return api(`/sessions/${session.id}`)
  }

  const detail = (sessionId) => api(`/sessions/${sessionId}`)

  /**
   * Wait until nothing runs or waits in the session and the model has stopped being asked: a
   * handoff starts the next participant's run moments after the last one ends.
   */
  async function waitIdle(sessionId, { timeoutMs = 60_000, quietMs = 1_500 } = {}) {
    const deadline = Date.now() + timeoutMs
    let quietSince = Date.now()
    const first = await detail(sessionId)
    let seen = requests({ session: first }).length
    while (Date.now() < deadline) {
      const current = await detail(sessionId)
      const count = requests({ session: current }).length
      const busy = current.isRunning || (current.queuedMessages?.length ?? 0) > 0 || count !== seen
      if (busy) {
        seen = count
        quietSince = Date.now()
      } else if (Date.now() - quietSince >= quietMs) return current
      await sleep(250)
    }
    throw new Error(`Session ${sessionId} did not settle within ${timeoutMs} ms`)
  }

  /** Send as the person without waiting: for a scenario that acts while the turn runs. */
  const send = (sessionId, prompt) => api(`/sessions/${sessionId}/messages`, { prompt })

  /** Send as the person and wait for every turn it starts to settle. */
  async function say(sessionId, prompt, options) {
    await send(sessionId, prompt)
    return waitIdle(sessionId, options)
  }

  /** Wait until a run is in flight in the session — by `handle`, when one is named. */
  async function waitRunning(sessionId, handle, { timeoutMs = 20_000 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const current = await detail(sessionId)
      if (current.isRunning && (!handle || current.activeAgentId === agentIds[handle]))
        return current
      await sleep(100)
    }
    throw new Error(`No ${handle ?? ''} run started in ${sessionId} within ${timeoutMs} ms`)
  }

  /** The transcript a person sees: author handle (or `user`) and text, in order. */
  const transcript = (session) =>
    session.messages
      .filter((message) => !message.payload.isInternal && !message.payload.systemNotice)
      .map((message) => ({
        from:
          message.payload.authorSnapshot?.handle ??
          (message.payload.role === 'user' ? 'user' : message.payload.from),
        text: typeof message.payload.content === 'string' ? message.payload.content : '',
      }))

  /** The system notice lines, by kind. */
  const notices = (session) =>
    session.messages.flatMap((message) =>
      message.payload.systemNotice ? [message.payload.systemNotice] : [],
    )

  return {
    routeEveryone,
    createSession,
    detail,
    waitIdle,
    send,
    say,
    waitRunning,
    transcript,
    notices,
    call,
  }
}
