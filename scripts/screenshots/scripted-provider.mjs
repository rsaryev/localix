/**
 * Capture-only Bun preload: a scripted OpenAI Responses stream for the isolated placeholder key.
 *
 * Start the isolated capture API with `BUN_OPTIONS="--preload <this file>"`. Only requests that
 * carry the seeded fake key are answered here; every other request reaches the real `fetch`. The
 * first turn calls the real `ask` tool, so the run genuinely blocks on a live HITL request. A turn
 * that already carries a tool result, or offers no `ask` tool, ends with a short text reply.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

const placeholderKey = 'capture-placeholder-not-a-credential'
export const scriptedQuestion = {
  id: 'release-lead',
  question: 'Which change should lead the release notes?',
  options: [
    { label: 'Shared workspace', description: 'Lead with the workspace everyone can open.' },
    { label: 'Team collaboration', description: 'Lead with reviewing changes together.' },
  ],
  recommended: 0,
}

const realFetch = globalThis.fetch

function authorization(input, init) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
  return headers.get('authorization') ?? ''
}

async function requestBody(input, init) {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
  try {
    return JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
  } catch {
    return {}
  }
}

function scriptedItem(body) {
  const tools = Array.isArray(body.tools) ? body.tools : []
  const ask = tools.find((tool) => tool.type === 'function' && /(^|[_.])ask$/.test(tool.name))
  const input = Array.isArray(body.input) ? body.input : []
  // Ask once per user turn: a turn that ends with the tool result gets the closing reply.
  const answered = input.at(-1)?.type === 'function_call_output'
  const turn = Date.now().toString(36)
  if (ask && !answered)
    return {
      type: 'function_call',
      id: `fc_capture_${turn}`,
      call_id: `call_capture_${turn}`,
      name: ask.name,
      arguments: JSON.stringify({ questions: [scriptedQuestion] }),
      status: 'completed',
    }
  return {
    type: 'message',
    id: 'msg_capture_reply',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Noted.', annotations: [] }],
  }
}

function response(item, status) {
  return {
    id: 'resp_capture',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: 'gpt-4o',
    output: status === 'completed' ? [item] : [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }
}

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
    .map((event, index) => {
      const payload = { ...event, sequence_number: index }
      return `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`
    })
    .join('')
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
}

globalThis.fetch = Object.assign(async function scriptedFetch(input, init) {
  if (!authorization(input, init).includes(placeholderKey)) return realFetch(input, init)
  const body = await requestBody(input, init)
  const item = scriptedItem(body)
  if (body.stream) return stream(item)
  return Response.json(response(item, 'completed'))
}, realFetch)

// Prove to the capture runner that the API process it talks to carries this preload.
if (process.env.LOCALIX_DB_FILE && process.env.PORT) {
  const markers = `${process.env.LOCALIX_DB_FILE}.scripted-provider`
  mkdirSync(markers, { recursive: true })
  writeFileSync(`${markers}/${process.pid}`, '')
}
