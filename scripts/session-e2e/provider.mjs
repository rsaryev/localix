/**
 * Session E2E Bun preload: a scripted model provider, and a log of every request the API sent it.
 *
 * Loaded into the isolated API (`BUN_OPTIONS=--preload=…`) by `harness.mjs`. Only requests that
 * carry the placeholder key are answered here; every other request reaches the real `fetch`, so a
 * run with a real connection still behaves as usual. Nothing reaches a provider.
 *
 * The REPLY is scripted by the person's message. Its text carries a `SCRIPT{…}` JSON object naming
 * what each agent does, step by step — inside an inline code span, so the handles in it are
 * references, not addresses the conversation would route:
 *
 *   Review the release. `SCRIPT{"localix":["@qa, verify the checkout."],"qa":["Verified."]}`
 *
 * A step is a reply text, or `{"tool":"<name>","args":{…}}` for a tool call (the tool must be on
 * the request's roster, or the step is logged as `missing` and answered with text). Either may
 * carry `"wait":<ms>` — the model takes that long to answer, which leaves a scenario time to act
 * while the run is in flight: `{"wait":2000,"text":"@qa, verify it."}`. Each
 * request of a speaker takes its next step; when its steps run out it answers `Done.`. A new
 * SCRIPT in a later message restarts every speaker's steps.
 *
 * The LOG (`SESSION_E2E_LOG`, JSON lines) is what scenarios assert on: per request, the session
 * (its `LOCALIX-<seq>` reference, as the runtime context names it), the speaker, the system prompt,
 * the runtime-context headings, the tool roster and the step answered. That is the run's real
 * input as the model would have read it — the prompt sections a policy rendered, the tools it held.
 */
import { appendFileSync } from 'node:fs'

import { PLACEHOLDER_KEY } from './placeholder.mjs'

const realFetch = globalThis.fetch
const logFile = process.env.SESSION_E2E_LOG
/** Steps already taken, by session, speaker and script. */
const taken = new Map()
let seq = 0

const isOurs = (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
  return (headers.get('authorization') ?? '').includes(PLACEHOLDER_KEY)
}

async function bodyOf(input, init) {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
  try {
    return JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
  } catch {
    return {}
  }
}

/** Every text an input item carries, flattened. */
function textsOf(item) {
  if (typeof item?.content === 'string') return [item.content]
  if (!Array.isArray(item?.content)) return typeof item?.output === 'string' ? [item.output] : []
  return item.content.flatMap((part) => (typeof part?.text === 'string' ? [part.text] : []))
}

function systemPromptOf(body) {
  if (typeof body.instructions === 'string') return body.instructions
  const input = Array.isArray(body.input) ? body.input : []
  return input
    .filter((item) => item.role === 'system' || item.role === 'developer')
    .flatMap(textsOf)
    .join('\n\n')
}

/** The last match of `pattern` anywhere in the request's input texts. */
function lastMatch(body, pattern) {
  const input = Array.isArray(body.input) ? body.input : []
  let found
  for (const text of input.flatMap(textsOf)) for (const m of text.matchAll(pattern)) found = m[1]
  return found
}

function speakerOf(body, system) {
  // Agents the harness creates carry `[e2e:agent=<handle>]` in their instructions.
  const marked = /\[e2e:agent=([a-z0-9_-]+)\]/i.exec(system)?.[1]
  return marked ?? lastMatch(body, /You are ([a-z0-9_-]+)\. Other participants/gi) ?? 'localix'
}

/** The JSON object that starts at `text[from]`, or undefined when none parses there. */
function objectAt(text, from) {
  for (let end = text.length; end > from; end -= 1) {
    if (text[end - 1] !== '}') continue
    try {
      return { key: text.slice(from, end), steps: JSON.parse(text.slice(from, end)) }
    } catch {
      /* a shorter prefix may still be the object */
    }
  }
  return undefined
}

/**
 * The latest message's FIRST `SCRIPT{…}` that parses — the outermost one: a step may itself carry
 * a script for a child (a `delegate` task), which must not be mistaken for this run's. The key
 * changes when the person writes a new one, which restarts every speaker's steps.
 */
function scriptOf(body) {
  const input = Array.isArray(body.input) ? body.input : []
  for (const item of [...input].reverse()) {
    if (item.role !== 'user') continue
    for (const text of textsOf(item)) {
      for (let at = text.indexOf('SCRIPT{'); at >= 0; at = text.indexOf('SCRIPT{', at + 1)) {
        const found = objectAt(text, at + 'SCRIPT'.length)
        if (found) return found
      }
    }
  }
  return { key: '', steps: {} }
}

function nextStep(sessionId, speaker, script) {
  const id = `${sessionId}|${speaker}|${script.key}`
  const index = taken.get(id) ?? 0
  taken.set(id, index + 1)
  const steps = script.steps[speaker]
  return Array.isArray(steps) && index < steps.length ? steps[index] : 'Done.'
}

function outputItem(step, tools) {
  const turn = `${Date.now().toString(36)}${(seq += 1)}`
  if (step && typeof step === 'object' && step.tool) {
    const tool = tools.find((name) => name === step.tool || name.endsWith(`__${step.tool}`))
    if (!tool) return { item: textItem(`(missing tool ${step.tool})`), missing: step.tool }
    return {
      item: {
        type: 'function_call',
        id: `fc_e2e_${turn}`,
        call_id: `call_e2e_${turn}`,
        name: tool,
        arguments: JSON.stringify(step.args ?? {}),
        status: 'completed',
      },
    }
  }
  return { item: textItem(typeof step === 'string' ? step : String(step?.text ?? 'Done.')) }
}

const textItem = (text) => ({
  type: 'message',
  id: `msg_e2e_${seq}`,
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
})

const response = (item, status) => ({
  id: `resp_e2e_${seq}`,
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status,
  model: 'gpt-4o',
  output: status === 'completed' ? [item] : [],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
})

function stream(item) {
  const events = [
    { type: 'response.created', response: response(item, 'in_progress') },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    ...(item.type === 'function_call'
      ? [
          {
            type: 'response.function_call_arguments.done',
            output_index: 0,
            item_id: item.id,
            arguments: item.arguments,
          },
        ]
      : []),
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: response(item, 'completed') },
  ]
  const text = events
    .map(
      (event, index) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`,
    )
    .join('')
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
}

globalThis.fetch = Object.assign(async function scriptedFetch(input, init) {
  if (!isOurs(input, init)) return realFetch(input, init)
  const body = await bodyOf(input, init)
  const system = systemPromptOf(body)
  const tools = (Array.isArray(body.tools) ? body.tools : []).flatMap((tool) =>
    tool?.name ? [tool.name] : [],
  )
  // A run's request carries its runtime context; an auxiliary one (a title) does not.
  const sessionId = lastMatch(body, /Session ID: (\S+)/g) ?? null
  const speaker = speakerOf(body, system)
  const step = sessionId ? nextStep(sessionId, speaker, scriptOf(body)) : 'Done.'
  const { item, missing } = outputItem(step, tools)
  // Logged before the wait, so a scenario sees the run start while its answer is delayed.
  const messages = (Array.isArray(body.input) ? body.input : [])
    .filter((entry) => entry.role !== 'system' && entry.role !== 'developer')
    .map((entry) => ({
      role: entry.role ?? entry.type,
      text: textsOf(entry).join('\n').slice(0, 400),
    }))
  if (logFile)
    appendFileSync(
      logFile,
      `${JSON.stringify({
        seq,
        at: new Date().toISOString(),
        sessionId,
        speaker,
        stream: Boolean(body.stream),
        tools,
        system,
        // The runtime-context sections the turn carried (`# Agent directory`, `# Current turn`…).
        contextHeadings: [
          ...new Set(
            (Array.isArray(body.input) ? body.input : [])
              .filter((item) => item.role !== 'system' && item.role !== 'developer')
              .flatMap(textsOf)
              .flatMap((text) => text.split('\n').filter((line) => line.startsWith('# '))),
          ),
        ],
        answered: item.type === 'function_call' ? { tool: item.name } : { text: textsOf(item)[0] },
        // What the model read besides the system prompt: role and the start of each message.
        messages,
        ...(missing ? { missing } : {}),
      })}\n`,
    )
  if (step && typeof step === 'object' && step.wait > 0)
    await new Promise((resolve) => setTimeout(resolve, step.wait))
  return body.stream ? stream(item) : Response.json(response(item, 'completed'))
}, realFetch)
